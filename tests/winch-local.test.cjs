const test=require('node:test');
const assert=require('node:assert/strict');
const {stateFrom,workerApi,authenticated,createLocalControl,sign}=require('../netlify/functions/lib/winch-local.cjs');
const {WINCHES}=require('../netlify/functions/lib/winch-control');
const {signPayload}=require('../netlify/functions/lib/winch-local.cjs');
const session='a'.repeat(64),ticket='b9b073e4-77bf-4c65-8e23-61240aaee7cd';
function memory(){
  const docs=new Map();
  const doc=key=>({key,get:async()=>({data:()=>docs.get(key)}),set:v=>docs.set(key,v),update:v=>Object.assign(docs.get(key),v)});
  const db={doc,runTransaction:fn=>fn({get:r=>r.get(),update:(r,v)=>Object.assign(docs.get(r.key),v)})};
  return {db,docs};
}

test('protocol 2 sends authenticated command inline and accepts acknowledgement without claim',async()=>{
  const {db,docs}=memory(),notices=[];
  docs.set('winch_server_locks/ha_local_status',{session,protocol:2});
  const control=createLocalControl({database:()=>db,env:{WINCH_SAFETY_CONFIRMED:'true'},notify:async(id,data)=>notices.push(data)});
  await control.move('up','2');
  const {payload,mac}=notices[0],command=JSON.parse(payload);
  assert.equal(command.action,'up');assert.equal(command.id,'2');assert.equal(command.v,2);
  assert.equal(mac,signPayload(session,payload));
  assert.notEqual(mac,signPayload(session,payload.replace('"up"','"down"')));
  assert(!payload.includes(session));
  await workerApi(db,{op:'ack',id:'2',ticket:command.ticket,session,ok:true});
  assert.equal(docs.get('winch_server_locks/ha_command_2').phase,'done');
});
test('reports describe relay status separately from permission to submit signals',()=>{
  const id='2', cfg=WINCHES[id],now=Date.now(), env={[cfg.enabledEnv]:'true'};
  const report={receivedAt:now,states:{[id]:{online:true,up:false,down:false,timer:cfg.safety.switch_inching,interlock:null}}};
  const control=createLocalControl({env});
  control.ensureReady(stateFrom(report,id,env,now));
  const different=Buffer.from(cfg.safety.switch_inching,'base64');
  different.writeUInt16BE(7,7); // batch 2 up is channel 3
  const varied={...report,states:{[id]:{...report.states[id],timer:different.toString('base64')}}};
  const mismatch=stateFrom(varied,id,env,now);
  assert.equal(mismatch.safetyMatches,false);
  assert.match(mismatch.safetyIssues.join(' '),/올림 7초 · 내림 6초/);
  control.ensureReady(stateFrom({...report,states:{[id]:{...report.states[id],interlock:"unused"}}},id,env,now));
  for(const change of [{timer:null},{up:null},{down:true},{online:false}]){
    const r={...report,states:{[id]:{...report.states[id],...change}}};
    control.ensureReady(stateFrom(r,id,env,now));
  }
  control.ensureReady(stateFrom(report,id,env,now+91000));
  assert.throws(()=>control.ensureReady(stateFrom(report,id,{},now)));
});
test('stale batch report permits one signed request without awaiting HA; missing session sends nothing',async()=>{
  const {db,docs}=memory(), notices=[];
  const control=()=>createLocalControl({database:()=>db,env:{WINCH_SAFETY_CONFIRMED:'true'},notify:async(id,data)=>notices.push(data)});
  await assert.rejects(control().move('up','2'));
  docs.set('winch_server_locks/ha_local_status',{session,receivedAt:Date.now()-120000,states:{}});
  const result=await control().move('up','2');
  assert.equal(result.accepted,true);
  const message=docs.get('winch_server_locks/ha_command_2');
  assert.equal(message.phase,'waiting');
  assert.equal(notices[0].mac,sign(session,'2',message.ticket));
  await assert.rejects(control().move('down','2'));
  assert.equal(notices.length,1);
  assert.equal(docs.get('winch_server_locks/ha_command_2').ticket,message.ticket);
});
test('private mailbox delivers once and rejects stale, wrong-session and wrong-batch claims',async()=>{
  const {db,docs}=memory();
  const address='winch_server_locks/ha_command_2';
  docs.set(address,{ticket,action:'down',session,expires:Date.now()+9000,phase:'waiting'});
  const msg={op:'claim',id:'2',session,ticket};
  assert.equal((await workerApi(db,{...msg,id:'3'})).command,null);
  assert.equal((await workerApi(db,{...msg,session:'0'.repeat(64)})).command,null);
  assert.equal((await workerApi(db,msg)).command.action,'down');
  assert.equal((await workerApi(db,msg)).command,null);
  await workerApi(db,{...msg,op:'ack',ok:true});
  assert.equal(docs.get(address).phase,'done');
  docs.set(address,{...docs.get(address),phase:'waiting',expires:Date.now()-1});
  assert.equal((await workerApi(db,msg)).command,null);
  assert(!authenticated(''));assert(!authenticated(session));
});
test('signal history survives new requests and HA acknowledgements and keeps the latest 20',async()=>{
  const {db,docs}=memory();
  const key='winch_server_locks/ha_command_2';
  docs.set('winch_server_locks/ha_local_status',{session});
  for(let index=0;index<22;index++){
    const control=createLocalControl({database:()=>db,env:{WINCH_SAFETY_CONFIRMED:'true'},notify:async()=>{
      docs.get(key).phase='done';
      docs.get(key).ok=true;
    }});
    await control.move(index%2?'down':'up','2',index%2?{}:{mode:'auto',temperature:26});
  }
  assert.equal(docs.get(key).phase,'done');
  const control=createLocalControl({database:()=>db,env:{}});
  const state=await control.getState('2');
  assert.equal(state.signalHistory.length,20);
  assert.equal(state.signalHistory[0].mode,'manual');
  assert.equal(state.signalHistory[1].temperature,26);
  assert(state.signalHistory.every(entry=>entry.status==='sent'));
  const failing=createLocalControl({database:()=>db,env:{},notify:async()=>{throw Error('network');}});
  await assert.rejects(failing.move('stop','2'));
  assert.equal(docs.get(key).history[0].status,'registered');
  assert.equal(docs.get(key).history[0].action,'stop');
});

test('stop follows an outstanding ticket even if HA rejects that earlier signal',async()=>{
  const {db,docs}=memory();
  const key='winch_server_locks/ha_command_2';
  docs.set('winch_server_locks/ha_local_status',{session});
  docs.set(key,{session,ticket,expires:Date.now()+9000,phase:'claimed'});
  let finish;
  const subscribed=new Promise(resolve=>{
    const doc=db.doc;
    db.doc=path=>({...doc(path),onSnapshot(callback){
      finish=()=>callback({data:()=>({ticket,phase:'done',ok:false})});
      resolve();
      return ()=>{};
    }});
  });
  const notices=[];
  const control=createLocalControl({database:()=>db,env:{},notify:async(id,data)=>notices.push(data)});
  const stop=control.move('stop','2');
  await subscribed;
  assert.equal(notices.length,0);
  finish();
  await stop;
  assert.equal(docs.get(key).action,'stop');
  assert.equal(notices.length,1);
});

test('old and new HA reports give all seven batches timer-only readiness',async()=>{
  const {db,docs}=memory(),env={};
  for(const legacy of [true,false]){
    const states={};
    for(const [id,cfg] of Object.entries(WINCHES)){
      env[cfg.enabledEnv]='true';
      states[id]={online:true,up:false,down:false,timer:cfg.safety.switch_inching,
        ...(legacy?{interlock:'irrelevant'}:{})};
    }
    await workerApi(db,{op:'report',session,states});
    const saved=docs.get('winch_server_locks/ha_local_status');
    for(const id of Object.keys(WINCHES)){
      assert(!Object.hasOwn(saved.states[id],'interlock'));
      assert.equal(stateFrom(saved,id,env).safetyMatches,true);
    }
  }
});
