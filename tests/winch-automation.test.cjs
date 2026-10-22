const test=require('node:test');
const assert=require('node:assert/strict');
const {createAutomation,nextAction,MIN_COMMAND_INTERVAL}=require('../netlify/functions/lib/winch-automation.cjs');
const {createHaTemperatureReader,parseHaTemperature,parseKoreanTimestamp,MAX_SAMPLE_AGE}=require('../netlify/functions/lib/winch-ha-temperature.cjs');
const {serviceAccountConfig,databaseError}=require('../netlify/functions/lib/winch-errors.cjs');
const timestamp=time=>{
  const d=new Date(time+9*60*60*1000),h=d.getUTCHours(),pad=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}. ${d.getUTCMonth()+1}. ${d.getUTCDate()}. ${h>=12?'오후':'오전'} ${h%12||12}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const {thresholdsFor,createSetpointReader}=require('../netlify/functions/lib/winch-setpoint.cjs');
const OFFSETS={up:[0.3,1.5,3],down:[-0.3,-1.5,-3]};
const readOffsets=async()=>({configured:true,revision:1,offsets:OFFSETS});
function fixture(){
  let clock=1800000000000,state,temperature=24,online=true,failMove=false,failWrite=false,failFinal=false;
  let sensorAge=0,readFailure=false,target=24,settingsFailure=false;
  const moves=[],writes=[];
  let queue=Promise.resolve();
  const store={read:async()=>structuredClone(state),write:async(id,value)=>{
    if(failWrite||failFinal&&value.lastAction)throw Error('write failed');
    state=structuredClone(value);writes.push(structuredClone(value));
  }};
  const control={getState:async()=>({online}),ensureReady:s=>{if(!s.online)throw Object.assign(Error('offline'),{status:409});},
    move:async(action,id)=>{moves.push({action,id});if(failMove)throw Error('timeout');return {message:'accepted'};}};
  const automation=createAutomation({store,control,now:()=>clock,readSettings:async()=>{if(settingsFailure)throw Object.assign(Error('settings missing'),{status:409});return thresholdsFor(target,OFFSETS);},
    withLock:async(action,run,id)=>{assert.equal(id,'2');const pending=queue.then(run);queue=pending.catch(()=>{});return pending;},
    readTemperature:async id=>{
      assert.equal(id,'2');if(readFailure)throw Error('network');
      return parseHaTemperature({temp:temperature,timestamp:timestamp(clock-sensorAge),online},clock);
    }});
  return {automation,moves,writes,setTarget:value=>target=value,setSettingsFailure:value=>settingsFailure=value,get state(){return state;},setState:value=>state={schemaVersion:2,paused:false,...value},
    advance:()=>clock+=MIN_COMMAND_INTERVAL,setTemperature:value=>temperature=value,setOnline:value=>online=value,
    setSensorAge:value=>sensorAge=value,setReadFailure:value=>readFailure=value,
    failMove:()=>failMove=true,failWrite:()=>failWrite=true,failFinal:()=>failFinal=true};
}
test('exact boundaries and hysteresis prevent repeats at every stage',()=>{
  for(const [stage,temp,expected] of [[0,24.2,null],[0,24.3,{action:'up',stage:1}],[1,25.4,null],[1,25.5,{action:'up',stage:2}],
    [2,26.9,null],[2,27,{action:'up',stage:3}],[3,23.8,null],[3,23.7,{action:'down',stage:2}],
    [2,22.6,null],[2,22.5,{action:'down',stage:1}],[1,21.1,null],[1,21,{action:'down',stage:0}],
    [0,15,null],[3,35,null],[1,23.7,null],[1,24.3,null],[-1,30,null],[1,NaN,null]])assert.deepEqual(nextAction(stage,temp,thresholdsFor(24,OFFSETS)),expected);
});

test('each batch reads its own saved first-group temperature and validates it',async()=>{
  const paths=[];
  const reader=createSetpointReader({readOffsets,registry:{'1':{},'2':{}},database:()=>({doc:path=>{
    paths.push(path);return {get:async()=>({data:()=>({ventilationOverrides:{f500_1:{t:path.endsWith('1')?26:22}}})})};
  }})});
  assert.deepEqual(await reader('1'),{targetTemperature:26,up:[26.3,27.5,29],down:[25.7,24.5,23],offsets:OFFSETS,revision:1});
  assert.equal((await reader('2')).up[0],22.3);
  assert.deepEqual(paths,['farms/sungamfarm/grower/batch_1','farms/sungamfarm/grower/batch_2']);
  await assert.rejects(()=>reader('../1'));assert.equal(paths.length,2);
  for(const t of [null,undefined,'24',24.5,NaN,Infinity,4,41])assert.throws(()=>thresholdsFor(t,OFFSETS));
  const broken=createSetpointReader({readOffsets,registry:{'1':{}},database:()=>({doc:()=>({get:async()=>{throw Error('secret');}})})});
  await assert.rejects(()=>broken('1'),error=>error.status===409&&!error.message.includes('secret'));
});

test('shifted thresholds use exact boundaries in both directions',()=>{
  const settings=thresholdsFor(26,OFFSETS);
  for(const [stage,temp,result] of [[0,26.2,null],[0,26.3,{action:'up',stage:1}],
    [1,27.4,null],[1,27.5,{action:'up',stage:2}],[2,28.9,null],[2,29,{action:'up',stage:3}],
    [3,25.8,null],[3,25.7,{action:'down',stage:2}],[2,24.6,null],[2,24.5,{action:'down',stage:1}],
    [1,23.1,null],[1,23,{action:'down',stage:0}]])assert.deepEqual(nextAction(stage,temp,settings),result);
  assert.equal(nextAction(0,30),null);
});

test('running automation rereads changed setpoint without resetting stage or repeating commands',async()=>{
  const f=fixture();f.setTarget(26);f.setTemperature(24.3);await f.automation.enable('2',0);
  f.advance();await f.automation.tick('2');assert.equal(f.moves.length,0);
  f.setTarget(24);f.advance();await f.automation.tick('2');assert.equal(f.state.stage,1);assert.equal(f.moves.length,1);
  assert.equal(f.state.settings.targetTemperature,24);
  f.advance();await f.automation.tick('2');assert.equal(f.moves.length,1);
});

test('missing settings blocks starting and pauses existing automation without fallback',async()=>{
  const f=fixture();f.setSettingsFailure(true);
  await assert.rejects(()=>f.automation.enable('2',0));assert.equal(f.state,undefined);
  assert.match((await f.automation.probe('2')).settingsError,/settings missing/);
  f.setSettingsFailure(false);await f.automation.enable('2',0);f.setTemperature(30);f.advance();
  f.setSettingsFailure(true);await f.automation.tick('2');assert.equal(f.state.stage,0);assert.equal(f.moves.length,0);
  f.setSettingsFailure(false);await f.automation.tick('2');assert.equal(f.moves.length,1);
});
test('enable validates stage, persists setup and never moves a device',async()=>{
  const f=fixture();for(const stage of [null,undefined,'1',-1,4,1.2])await assert.rejects(()=>f.automation.enable('2',stage));
  await f.automation.enable('2',0);assert.equal(f.state.enabled,true);assert.equal(f.moves.length,0);
  await assert.rejects(()=>f.automation.enable('2',2));
});
test('three full stages each way execute once with five minute separation',async()=>{
  const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,1);
  await f.automation.tick('2');assert.equal(f.moves.length,1);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,2);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,3);
  f.advance();await f.automation.tick('2');assert.equal(f.moves.length,3);
  f.setTemperature(20);f.advance();await f.automation.tick('2');assert.equal(f.state.stage,2);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,1);
  f.advance();await f.automation.tick('2');assert.equal(f.state.stage,0);
  f.advance();await f.automation.tick('2');assert.deepEqual(f.moves.map(x=>x.action),['up','up','up','down','down','down']);
  assert.equal(MIN_COMMAND_INTERVAL,300000);
});
test('concurrent scheduled invocations cannot issue duplicate commands',async()=>{
  const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);f.advance();
  await Promise.all([f.automation.tick('2'),f.automation.tick('2')]);assert.equal(f.moves.length,1);
});
test('manual up and down preserve automatic mode, update stage and defer automation five minutes',async()=>{
  for(const [action,stage,temp,next] of [['up',2,28,'up'],['down',0,28,'up']]){
    const f=fixture();await f.automation.enable('2',1);f.advance();
    await f.automation.manual(action,'2');assert.equal(f.state.enabled,true);assert.equal(f.state.paused,false);assert.equal(f.state.stage,stage);
    assert(f.writes.some(s=>s.pending?.action===action));
    f.setTemperature(temp);await f.automation.tick('2');assert.equal(f.moves.length,1);
    f.advance();await f.automation.tick('2');assert.deepEqual(f.moves,[{action,id:'2'},{action:next,id:'2'}]);
  }
});

test('stop pauses automatic mode until stage is confirmed and resumed',async()=>{
  const f=fixture();await f.automation.enable('2',1);await f.automation.manual('stop','2');
  assert.equal(f.state.enabled,true);assert.equal(f.state.paused,true);assert.equal(f.state.stage,null);
  f.setTemperature(30);f.advance();await f.automation.tick('2');assert.equal(f.moves.length,1);
  await f.automation.enable('2',1);await f.automation.tick('2');assert.equal(f.moves.length,1);
  f.advance();await f.automation.tick('2');assert.equal(f.moves.length,2);
});

test('uninitialized, legacy and out-of-range manual positions never guess a stage',async()=>{
  for(const stage of [null,0,3]){
    const f=fixture();if(stage!==null)await f.automation.enable('2',stage);
    await f.automation.manual(stage===0?'down':'up','2');assert.equal(f.state.paused,true);assert.equal(f.state.stage,null);
    f.advance();await f.automation.tick('2');assert.equal(f.moves.length,1);
  }
  const f=fixture();f.setState({schemaVersion:1,enabled:true,stage:2});
  const state=await f.automation.status('2');assert.equal(state.enabled,true);assert.equal(state.paused,true);assert.equal(state.stage,null);
  f.setTemperature(30);f.advance();await f.automation.tick('2');assert.equal(f.moves.length,0);
});

test('failed manual movement or final write pauses without replay; failed intent sends nothing',async()=>{
  for(const failure of ['failMove','failFinal','failWrite']){
    const f=fixture();await f.automation.enable('2',1);f[failure]();
    await assert.rejects(()=>f.automation.manual('up','2'));
    assert.equal(f.moves.length,failure==='failWrite'?0:1);
    if(failure!=='failWrite'){assert(f.state.paused||f.state.pending);f.advance();await f.automation.tick('2');assert.equal(f.moves.length,1);}
  }
});
test('a crash with a persisted pending command pauses automatic mode without replay',async()=>{
  const f=fixture();f.setState({enabled:true,stage:0,pending:{action:'up'},lastActionAt:0});
  await f.automation.tick('2');assert.equal(f.moves.length,0);assert.equal(f.state.paused,true);
});
test('uncertain device command or final persistence failure stops automation',async()=>{
  for(const failure of ['failMove','failFinal']){const f=fixture();await f.automation.enable('2',0);f.setTemperature(28);f.advance();f[failure]();
    await f.automation.tick('2');assert.equal(f.state.paused,true);assert.equal(f.state.stage,null);
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
test('HA temperature validates values and the original sensor timestamp',()=>{
  const now=Date.parse('2026-10-20T12:25:00Z'),record={temp:23.7,timestamp:'2026. 10. 20. 오후 9:25:00'};
  assert.deepEqual(parseHaTemperature(record,now),{temperature:23.7,measuredAt:now,source:'ha'});
  for(const temp of [0,'0','23.7',-40,80])assert.equal(parseHaTemperature({...record,temp},now).temperature,Number(temp));
  for(const temp of [null,undefined,'',' ','unknown','unavailable','--',NaN,Infinity,true,[],{},'23.7C',-41,81])
    assert.throws(()=>parseHaTemperature({...record,temp},now));
  for(const data of [null,{}, {...record,online:false},{...record,available:false},{...record,unit:'°F'},
    {...record,timestamp:undefined},{...record,timestamp:timestamp(now-MAX_SAMPLE_AGE)},
    {...record,timestamp:timestamp(now+31000)}])assert.throws(()=>parseHaTemperature(data,now));
  assert.equal(parseHaTemperature({...record,timestamp:timestamp(now-MAX_SAMPLE_AGE+1000)},now).measuredAt,now-MAX_SAMPLE_AGE+1000);
});
test('read-only probe does not enable automation or send commands',async()=>{
  const f=fixture();const result=await f.automation.probe('2');assert.equal(result.auto.enabled,true);assert.equal(result.auto.paused,true);assert.equal(result.sample.temperature,24);
  assert.equal(f.moves.length,0);assert.equal(f.writes.length,0);
});

test('Korean sensor timestamps handle midnight, noon and invalid dates independently of host timezone',()=>{
  for(const [input,expected] of [
    ['2026. 10. 20. 오전 12:00:00','2026-10-19T15:00:00Z'],
    ['2026. 10. 20. 오후 12:00:00','2026-10-20T03:00:00Z'],
    ['2028. 2. 29. 오후 1:02:03','2028-02-29T04:02:03Z']
  ])assert.equal(parseKoreanTimestamp(input),Date.parse(expected));
  for(const input of [null,'2026. 2. 29. 오전 1:00:00','2026. 4. 31. 오후 1:00:00',
    '2026. 13. 1. 오전 1:00:00','2026. 1. 0. 오전 1:00:00','2026. 1. 1. 오전 0:00:00',
    '2026. 1. 1. 오후 13:00:00','2026. 1. 1. 오전 1:60:00','2026. 1. 1. 오전 1:00:60',
    '2026-10-20',Date.now()])assert(Number.isNaN(parseKoreanTimestamp(input)));
});

test('HA reader only fetches the mapped Firebase record, without Tuya or writes',async()=>{
  const now=1800000000000,calls=[];
  const readTemperature=createHaTemperatureReader({registry:{'2':{haSensorKey:'육성_2배치'}},now:()=>now,
    fetchImpl:async(url,options)=>{calls.push({url,options});
      return {ok:true,json:async()=>({temp:24.1,timestamp:timestamp(now-1000)})};}});
  const automation=createAutomation({readTemperature,readSettings:async()=>thresholdsFor(24,OFFSETS),store:{read:async()=>null}});
  const result=await automation.probe('2');
  assert.deepEqual(result.sample,{temperature:24.1,measuredAt:now-1000,source:'ha'});
  assert.equal(result.auto.enabled,true);assert.equal(result.auto.paused,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://sungamfarm-default-rtdb.firebaseio.com/sensor_logs/'+encodeURIComponent('육성_2배치')+'.json');
  assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.cache,'no-store');
  await assert.rejects(()=>readTemperature('3'));assert.equal(calls.length,1);
});

test('failed or stale HA reads block enabling and pause ticks without movement',async()=>{
  for(const failure of ['stale','network']){
    const f=fixture();
    await f.automation.enable('2',0);f.setTemperature(28);f.advance();
    if(failure==='stale')f.setSensorAge(MAX_SAMPLE_AGE);else f.setReadFailure(true);
    await f.automation.tick('2');assert.equal(f.moves.length,0);assert.equal(f.state.stage,0);
    const result=await f.automation.probe('2');assert(result.sensorError);assert(!result.sample);
    f.setState({enabled:false});
    await assert.rejects(()=>f.automation.enable('2',0));assert.equal(f.state.enabled,false);
  }
});

test('HA reader rejects HTTP errors, invalid JSON and timeouts without retry or secret leakage',async()=>{
  for(const fetchImpl of [async()=>({ok:false,status:403}),
    async()=>({ok:true,json:async()=>{throw Error('bad JSON');}}),
    async()=>{throw Error('secret token timeout');}]){
    let calls=0;
    const read=createHaTemperatureReader({registry:{'2':{haSensorKey:'육성_2배치'}},fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
    await assert.rejects(()=>read('2'),error=>error.status===409&&!error.message.includes('secret'));
    assert.equal(calls,1);
  }
});
test('credential parser reports malformed JSON and normalizes escaped PEM newlines without exposing values',()=>{
  for(const value of ['', 'not-json','{}','"string"'])assert.throws(()=>serviceAccountConfig(value),/형식 오류/);
  const parsed=serviceAccountConfig(JSON.stringify({project_id:'test',client_email:'test@example.com',private_key:'line1\\nline2'}));
  assert.equal(parsed.private_key,'line1\nline2');
  const error=databaseError({code:7,message:'secret raw error'});assert.match(error.message,/7/);assert(!error.message.includes('secret'));
});
