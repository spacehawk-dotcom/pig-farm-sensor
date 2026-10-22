const test=require('node:test');
const assert=require('node:assert/strict');
const {validateOffsets,createOffsetStore}=require('../netlify/functions/lib/winch-offsets.cjs');
const {createHandler}=require('../netlify/functions/lib/winch-control');
const valid={up:[0.3,1.5,3],down:[-0.3,-1.5,-3]};
test('six signed offsets require increasing distance and reject malformed values',()=>{
  assert.deepEqual(validateOffsets(valid),valid);
  for(const offsets of [null,{}, {...valid,up:[0.3,3]}, {...valid,up:[0.3,0.3,3]},
    {...valid,up:[0.3,3,1.5]}, {...valid,down:[-0.3,-3,-1.5]}, {...valid,down:[0.3,1.5,3]},
    {...valid,up:[0,1,2]}, {...valid,up:[0.35,1,2]}, {...valid,up:[0.3,1,21]},
    {...valid,up:['0.3',1,2]}, {...valid,up:[NaN,1,2]}, {...valid,down:[null,-1,-2]}])
    assert.throws(()=>validateOffsets(offsets));
});
test('offset store persists atomically and rejects stale saves without overwriting',async()=>{
  let saved;const paths=[];
  const db={doc:path=>{paths.push(path);return {get:async()=>({data:()=>saved})};},
    runTransaction:async fn=>fn({get:async()=>({data:()=>saved}),set:(ref,value)=>saved=structuredClone(value)})};
  const store=createOffsetStore({database:()=>db,now:()=>123});
  assert.deepEqual(await store.read(),{configured:false,revision:0,offsets:valid});
  assert.deepEqual(await store.save(valid,0),{configured:true,revision:1,offsets:valid});
  assert.equal(saved.updatedAt,123);assert.equal((await store.read()).revision,1);
  await assert.rejects(()=>store.save({up:[1,2,3],down:[-1,-2,-3]},0),/다른 화면/);
  assert.deepEqual(saved.offsets,valid);assert(paths.every(path=>path==='winch_server_locks/temperature_offsets'));
});
test('offset APIs authenticate every read and save and never contact a device',async()=>{
  const calls=[];
  const handler=createHandler({env:{WINCH_CONTROL_PASSWORD:'Abcde12345'},request:async()=>{throw Error('device must not be contacted');},
    offsetStore:{read:async()=>{calls.push('read');return {configured:false,revision:0};},
      save:async(offsets,revision)=>{calls.push({offsets,revision});return {configured:true,revision:1};}}});
  const send=(action,password='Abcde12345')=>handler({httpMethod:'POST',headers:{'x-winch-password':password},body:JSON.stringify({action,offsets:valid,revision:0})});
  for(const action of ['offsets_get','offsets_save'])assert.equal((await send(action,'wrong')).statusCode,401);
  assert.equal(calls.length,0);
  assert.equal((await send('offsets_get')).statusCode,200);
  assert.equal((await send('offsets_save')).statusCode,200);
  assert.deepEqual(calls,['read',{offsets:valid,revision:0}]);
});
