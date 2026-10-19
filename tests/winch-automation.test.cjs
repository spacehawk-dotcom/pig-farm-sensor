const test=require('node:test');
const assert=require('node:assert/strict');
const {createAutomation,nextAction,parseTemperature,MAX_SAMPLE_AGE,MIN_COMMAND_INTERVAL}=require('../netlify/functions/lib/winch-automation.cjs');
const {serviceAccountConfig,databaseError}=require('../netlify/functions/lib/winch-errors.cjs');
const sample=(temperature,time)=>({properties:[{code:'va_temperature',value:temperature*10,time}]});
const specification={status:[{code:'va_temperature',values:JSON.stringify({unit:'℃',scale:1})}]};
function fixture(){
  let clock=1800000000000,state,temperature=24,online=true,failMove=false,failWrite=false,failFinal=false;
  const moves=[],writes=[],requests=[];
  let queue=Promise.resolve();
  const store={read:async()=>structuredClone(state),write:async(id,value)=>{
    if(failWrite||failFinal&&value.lastAction)throw Error('write failed');
    state=structuredClone(value);writes.push(structuredClone(value));
  }};
  const control={getState:async()=>({online}),ensureReady:s=>{if(!s.online)throw Object.assign(Error('offline'),{status:409});},
    move:async(action,id)=>{moves.push({action,id});if(failMove)throw Error('timeout');return {message:'accepted'};}};
  const automation=createAutomation({registry:{'2':{sensorId:'sensor2'}},store,control,now:()=>clock,
    withLock:async(action,run,id)=>{assert.equal(id,'2');const pending=queue.then(run);queue=pending.catch(()=>{});return pending;},
    request:async(method,path)=>{requests.push({method,path});assert.equal(method,'GET');
      if(path.endsWith('/specifications'))return specification;
      if(path.endsWith('/shadow/properties'))return sample(temperature,clock);
      return {online};
    }});
  return {automation,moves,writes,requests,get state(){return state;},setState:value=>state=value,
    advance:()=>clock+=MIN_COMMAND_INTERVAL,setTemperature:value=>temperature=value,setOnline:value=>online=value,
    failMove:()=>failMove=true,failWrite:()=>failWrite=true,failFinal:()=>failFinal=true};
}
test('exact boundaries and hysteresis prevent repeats at every stage',()=>{
  for(const [stage,temp,expected] of [[0,24.2,null],[0,24.3,{action:'up',stage:1}],[1,26.9,null],[1,27,{action:'up',stage:2}],
    [2,23.8,null],[2,23.7,{action:'down',stage:1}],[1,21.1,null],[1,21,{action:'down',stage:0}],
    [0,15,null],[2,35,null],[1,23.7,null],[1,24.3,null],[-1,30,null],[1,NaN,null]])assert.deepEqual(nextAction(stage,temp),expected);
});
test('enable validates stage, persists setup and never moves a device',async()=>{
  const f=fixture();for(const stage of [null,undefined,'1',-1,3,1.2])await assert.rejects(()=>f.automation.enable('2',stage));
  await f.automation.enable('2',0);assert.equal(f.state.enabled,true);assert.equal(f.moves.length,0);
  await assert.rejects(()=>f.automation.enable('2',2));
});
test('two full stages each way execute once with five minute separation',async()=>{
  const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,1);
  await f.automation.tick('2');assert.equal(f.moves.length,1);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,2);
  f.advance();await f.automation.tick('2');assert.equal(f.moves.length,2);
  f.setTemperature(20);f.advance();await f.automation.tick('2');assert.equal(f.state.stage,1);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,0);
  f.advance();await f.automation.tick('2');assert.deepEqual(f.moves.map(x=>x.action),['up','up','down','down']);
  assert.equal(MIN_COMMAND_INTERVAL,300000);
});
test('concurrent scheduled invocations cannot issue duplicate commands',async()=>{
  const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);f.advance();
  await Promise.all([f.automation.tick('2'),f.automation.tick('2')]);assert.equal(f.moves.length,1);
});
test('manual movement or stop cancels automatic mode before sending',async()=>{
  for(const action of ['up','down','stop']){const f=fixture();await f.automation.enable('2',1);
    await f.automation.manual(action,'2');assert.equal(f.state.enabled,false);assert.equal(f.state.stage,null);
    f.advance();await f.automation.tick('2');assert.deepEqual(f.moves,[{action,id:'2'}]);}
});
test('a crash with a persisted pending command disables automatic mode without replay',async()=>{
  const f=fixture();f.setState({enabled:true,stage:0,pending:{action:'up'},lastActionAt:0});
  await f.automation.tick('2');assert.equal(f.moves.length,0);assert.equal(f.state.enabled,false);
});
test('uncertain device command or final persistence failure stops automation',async()=>{
  for(const failure of ['failMove','failFinal']){const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);f.advance();f[failure]();
    await f.automation.tick('2');assert.equal(f.state.enabled,false);assert.equal(f.state.stage,null);
    f.advance();await f.automation.tick('2');assert.equal(f.moves.length,1);}
});
test('intent persistence failure must never send a movement',async()=>{
  const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);f.advance();f.failWrite();
  await assert.rejects(()=>f.automation.tick('2'));assert.equal(f.moves.length,0);
});
test('offline sensor pauses and fresh recovery resumes from recorded stage',async()=>{
  const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);f.advance();f.setOnline(false);
  await f.automation.tick('2');assert.equal(f.moves.length,0);assert.equal(f.state.enabled,true);
  f.setOnline(true);await f.automation.tick('2');assert.equal(f.moves.length,1);
});
test('manual stop still sends OFF if automatic cancellation cannot be saved',async()=>{
  const f=fixture();f.failWrite();await assert.rejects(()=>f.automation.manual('stop','2'),/정지 명령은 전달/);
  assert.deepEqual(f.moves,[{action:'stop',id:'2'}]);
});
test('temperature requires Celsius scale, valid numeric value and recent measurement time',()=>{
  const now=1800000000000,online={online:true};
  assert.equal(parseTemperature(online,sample(0,now),specification,now).temperature,0);
  for(const shadow of [sample(25,now-MAX_SAMPLE_AGE-1),sample(25,now+30001),sample(25,undefined),sample(NaN,now),{properties:[]},
    {properties:[{code:'va_temperature',value:'250',time:now}]}])assert.throws(()=>parseTemperature(online,shadow,specification,now));
  assert.throws(()=>parseTemperature({online:false},sample(25,now),specification,now));
  assert.throws(()=>parseTemperature(online,sample(25,now),{status:[{code:'va_temperature',values:'{"unit":"F","scale":1}'}]},now));
});
test('read-only probe does not enable automation or send commands',async()=>{
  const f=fixture();const result=await f.automation.probe('2');assert.equal(result.auto.enabled,false);assert.equal(result.sample.temperature,24);
  assert.equal(f.moves.length,0);assert.equal(f.writes.length,0);
});
test('credential parser reports malformed JSON and normalizes escaped PEM newlines without exposing values',()=>{
  for(const value of ['', 'not-json','{}','"string"'])assert.throws(()=>serviceAccountConfig(value),/형식 오류/);
  const parsed=serviceAccountConfig(JSON.stringify({project_id:'test',client_email:'test@example.com',private_key:'line1\\nline2'}));
  assert.equal(parsed.private_key,'line1\nline2');
  const error=databaseError({code:7,message:'secret raw error'});assert.match(error.message,/7/);assert(!error.message.includes('secret'));
});
