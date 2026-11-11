const test=require('node:test');
const assert=require('node:assert/strict');
const {createHaOwner}=require('../netlify/functions/lib/winch-ha-owner.cjs');
const {createAutomation}=require('../netlify/functions/lib/winch-automation.cjs');
function setup(){
  let saved={schemaVersion:3,enabled:true,paused:false,lastActionAt:0},mailbox,report={};
  const calls=[];
  const store={read:async()=>saved,write:async(_,v)=>{saved=v;}};
  const settings={targetTemperature:24,up:[24.3,25.5,27],down:[23.7,22.5,21]};
  const withLock=async(_,fn)=>fn();
  const control={source:'test',move:async(...args)=>{calls.push(args);return {accepted:true};}};
  const legacy=createAutomation({store,withLock,control,readSettings:async()=>settings,
    readTemperature:async()=>{throw Error('server temperature must not be queried after handover');}});
  const owner=createHaOwner({legacy,store,withLock,control,readSettings:async()=>settings,
    readReport:async()=>report,readMailbox:async()=>mailbox,env:{ALLOW:'true'},registry:{'1':{enabledEnv:'ALLOW'}}});
  return {owner,calls,get saved(){return saved;},set mailbox(v){mailbox=v;},set report(v){report=v;}};
}
test('durable HA ownership suppresses server ticks even if HA reporting stops',async()=>{
  const s=setup();
  const config=await s.owner.configure(['1']);
  assert.equal(config.batches['1'].initial.paused,false);
  assert.equal(s.saved.owner,'ha');
  await s.owner.tick('1');
  assert.equal(s.calls.length,0);
  await s.owner.manual('up','1');
  assert.deepEqual(s.calls[0],['up','1']);
  await s.owner.enable('1');
  assert.equal(s.calls[1][0],'resume');
  assert.equal(s.calls[1][2].settings.targetTemperature,24);
});
test('handover waits for outstanding legacy command and preserves pause',async()=>{
  const s=setup();s.saved.paused=true;
  s.mailbox={phase:'waiting',expires:Date.now()+10000};
  assert.equal((await s.owner.configure(['1'])).batches['1'].allowed,false);
  assert.equal(s.saved.owner,undefined);
  s.mailbox={phase:'done'};
  assert.equal((await s.owner.configure(['1'])).batches['1'].initial.paused,true);
});
test('status and sample are taken from HA after handover',async()=>{
  const s=setup();await s.owner.configure(['1']);
  s.report={autos:{'1':{paused:true}},temperatures:{'1':{temperature:23.2,measuredAt:Date.now()}}};
  const status=await s.owner.probe('1');
  assert.equal(status.auto.paused,true);assert.equal(status.sample.temperature,23.2);
});
