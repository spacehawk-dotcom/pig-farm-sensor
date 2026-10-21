const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandler,SAFETY}=require('../netlify/functions/lib/winch-control');
const {WINCHES}=require('../netlify/functions/lib/winch-control');
function fixture(overrides={}){
  const calls=[];
  let values={switch_2:false,switch_3:false,...SAFETY,...overrides};
  const env={WINCH_CONTROL_PASSWORD:'Abcde12345',WINCH_SAFETY_CONFIRMED:'true'};
  const handler=createHandler({env,sleep:async()=>{},withLock:async(_,fn)=>fn(),request:async(method,path,body)=>{
    calls.push({method,path,body});
    if(method==='GET')return {online:true,status:Object.entries(values).map(([code,value])=>({code,value}))};
    body.commands.forEach(c=>values[c.code]=c.value);return true;
  }});
  const send=(action,password=env.WINCH_CONTROL_PASSWORD,batchId)=>handler({httpMethod:'POST',headers:{'x-winch-password':password},body:JSON.stringify({action,batchId})});
  return {calls,send,env};
}
test('unauthorized requests never contact device',async()=>{const f=fixture();assert.equal((await f.send('up','wrong')).statusCode,401);assert.equal(f.calls.length,0);});
test('password policy accepts ten mixed characters and rejects weak configuration',async()=>{
  const valid=fixture();assert.equal((await valid.send('status')).statusCode,200);
  for(const password of ['Abcd12345','abcdefghij','1234567890','']){
    const f=fixture();f.env.WINCH_CONTROL_PASSWORD=password;
    assert.equal((await f.send('status')).statusCode,503);assert.equal(f.calls.length,0);
  }
});
test('up/down use confirmed Tuya channels after OFF and status check',async()=>{
  for(const [action,channel] of [['up','switch_3'],['down','switch_2']]){
    const f=fixture();assert.equal((await f.send(action)).statusCode,200);
    assert.deepEqual(f.calls.map(c=>c.method),['GET','POST','GET','POST']);
    assert.deepEqual(f.calls[1].body.commands,[{code:'switch_2',value:false},{code:'switch_3',value:false}]);
    assert.deepEqual(f.calls[3].body.commands,[{code:channel,value:true}]);
  }
});
test('changed safety or moving relay blocks movement',async()=>{for(const value of [{switch_interlock:'different'},{switch_inching:''},{switch_2:true}]){const f=fixture(value);assert.equal((await f.send('up')).statusCode,409);assert(!f.calls.some(c=>c.method==='POST'));}});
test('disabled commissioning blocks movement but permits stop',async()=>{const f=fixture();f.env.WINCH_SAFETY_CONFIRMED='false';assert.equal((await f.send('down')).statusCode,409);assert.equal((await f.send('stop')).statusCode,200);assert(f.calls.filter(c=>c.method==='POST').every(c=>c.body.commands.every(x=>x.value===false)));});
test('invalid action never contacts device',async()=>{const f=fixture();assert.equal((await f.send('all_on')).statusCode,400);assert.equal(f.calls.length,0);});

test('one authenticated status request returns registered batches without commands',async()=>{
  const f=fixture();
  assert.equal((await f.send('status_all','wrong')).statusCode,401);
  assert.equal(f.calls.length,0);
  const response=await f.send('status_all');
  assert.equal(response.statusCode,200);
  const {batches}=JSON.parse(response.body);
  assert.deepEqual(Object.keys(batches),['1','2','3','4','5','6','7']);
  assert.equal(batches['2'].upSeconds,5);
  assert.equal(batches['2'].downSeconds,6);
  assert.equal(batches['2'].enabled,true);
  assert(f.calls.every(c=>c.method==='GET'));
  assert(!response.body.includes('bfb4be1d3b42f4b899zcv2'));
});

test('unregistered or malformed batch IDs never reach any device',async()=>{
  for(const id of ['0','8','2/../1','02','__proto__',null,{},['2']]){
    for(const action of ['up','down','stop','status','auto_status','auto_on','auto_off','diagnostics']){
      const f=fixture();
      assert.equal((await f.send(action,f.env.WINCH_CONTROL_PASSWORD,id)).statusCode,404);
      assert.equal(f.calls.length,0);
    }
  }
});

test('automatic setup and diagnostics require authentication and diagnostics never issues commands',async()=>{
  const f=fixture();
  for(const action of ['auto_status','auto_on','auto_off','diagnostics'])assert.equal((await f.send(action,'wrong','2')).statusCode,401);
  assert.equal(f.calls.length,0);
  const result=await f.send('diagnostics',f.env.WINCH_CONTROL_PASSWORD,'2');
  assert.equal(result.statusCode,200);assert(f.calls.every(c=>c.method==='GET'));
});

test('explicit batch routes commands and shared lock to batch 2',async()=>{
  let lockedBatch;
  const handler=createHandler({env:{WINCH_CONTROL_PASSWORD:'Abcde12345'},
    withLock:async(action,run,id)=>{lockedBatch=id;return run();},
    request:async(method,path,body)=>{
      assert.equal(path,'/v1.0/devices/bfb4be1d3b42f4b899zcv2/commands');
      assert(body.commands.every(c=>c.value===false));return true;
    }});
  const result=await handler({httpMethod:'POST',headers:{'x-winch-password':'Abcde12345'},body:JSON.stringify({action:'stop',batchId:'2'})});
  assert.equal(result.statusCode,200);assert.equal(lockedBatch,'2');
});

test('new batch channel mapping and commissioning remain isolated from batch 2',async()=>{
  // Synthetic device IDs and safety snapshots are test-only, never production registration.
  const registry={...WINCHES};
  const env={WINCH_CONTROL_PASSWORD:'Abcde12345',WINCH_SAFETY_CONFIRMED:'true'};
  for(const id of ['1','3','4','5','6','7']){
    registry[id]={deviceId:`test-winch-${id}`,upChannel:'switch_1',downChannel:'switch_2',
      upSeconds:5,downSeconds:6,safety:{switch_interlock:`test-interlock-${id}`,switch_inching:`test-timer-${id}`},
      enabledEnv:`WINCH_${id}_SAFETY_CONFIRMED`,haSensorKey:`육성_${id}배치`};
    env[registry[id].enabledEnv]='true';
  }
  const calls=[],locks=[],states=Object.fromEntries(Object.values(registry).map(c=>[c.deviceId,{
    switch_1:false,switch_2:false,switch_3:false,...c.safety
  }]));
  const handler=createHandler({registry,env,sleep:async()=>{},
    withLock:async(action,run,id)=>{locks.push(id);return run();},
    request:async(method,path,body)=>{
      const deviceId=path.split('/')[3],values=states[deviceId];assert(values);
      calls.push({method,path,body});
      if(method==='GET')return {online:true,status:Object.entries(values).map(([code,value])=>({code,value}))};
      body.commands.forEach(c=>values[c.code]=c.value);return true;
    }});
  const send=(action,batchId)=>handler({httpMethod:'POST',headers:{'x-winch-password':env.WINCH_CONTROL_PASSWORD},body:JSON.stringify({action,batchId})});
  const all=JSON.parse((await send('status_all')).body);
  assert.deepEqual(Object.keys(all.batches),['1','2','3','4','5','6','7']);
  assert(calls.every(c=>c.method==='GET'));
  for(const id of ['1','3','4','5','6','7']){
    for(const [action,channel] of [['up','switch_1'],['down','switch_2']]){
      calls.length=0;
      assert.equal((await send(action,id)).statusCode,200);
      assert.equal(locks.at(-1),id);
      assert(calls.every(c=>c.path.startsWith(`/v1.0/devices/test-winch-${id}`)));
      assert.deepEqual(calls.at(-1).body.commands,[{code:channel,value:true}]);
      assert(calls.filter(c=>c.method==='POST').every(c=>c.body.commands.every(x=>['switch_1','switch_2'].includes(x.code))));
      await send('stop',id);
    }
  }
  env.WINCH_3_SAFETY_CONFIRMED='false';calls.length=0;
  assert.equal((await send('up','3')).statusCode,409);
  assert(!calls.some(c=>c.method==='POST'));
  assert.equal((await send('up','1')).statusCode,200);await send('stop','1');
  states['test-winch-4'].switch_inching='changed';calls.length=0;
  assert.equal((await send('down','4')).statusCode,409);
  assert(!calls.some(c=>c.method==='POST'));
});

test('missing commissioning snapshot fails closed even if the enable flag is true',async()=>{
  for(const safety of [null,{}]){
    const calls=[],registry={'1':{...WINCHES['1'],safety}};
    const handler=createHandler({registry,env:{WINCH_CONTROL_PASSWORD:'Abcde12345',WINCH_1_SAFETY_CONFIRMED:'true'},
      request:async(method)=>{calls.push(method);return {online:true,status:[
        {code:'switch_1',value:false},{code:'switch_2',value:false}
      ]};},withLock:async(_,run)=>run()});
    const result=await handler({httpMethod:'POST',headers:{'x-winch-password':'Abcde12345'},body:JSON.stringify({action:'up',batchId:'1'})});
    assert.equal(result.statusCode,409);assert.deepEqual(calls,['GET']);
  }
});
