const test=require('node:test');
const assert=require('node:assert/strict');
const {stateFrom,workerApi,authenticated,createLocalControl}=require('../netlify/functions/lib/winch-local.cjs');
const {WINCHES}=require('../netlify/functions/lib/winch-control');
const session='a'.repeat(64),ticket='b9b073e4-77bf-4c65-8e23-61240aaee7cd';
function memory(){
  const docs=new Map();
  const doc=key=>({key,get:async()=>({data:()=>docs.get(key)}),set:v=>docs.set(key,v)});
  const db={doc,runTransaction:fn=>fn({get:r=>r.get(),update:(r,v)=>Object.assign(docs.get(r.key),v)})};
  return {db,docs};
}
test('unknown or stale HA outputs and missing safety values never enable movement',()=>{
  const id='2', cfg=WINCHES[id],now=Date.now(), env={[cfg.enabledEnv]:'true'};
  const report={receivedAt:now,states:{[id]:{online:true,up:false,down:false,timer:cfg.safety.switch_inching,interlock:cfg.safety.switch_interlock}}};
  const control=createLocalControl({env});
  control.ensureReady(stateFrom(report,id,env,now));
  const different=Buffer.from(cfg.safety.switch_inching,'base64');
  different.writeUInt16BE(7,7); // batch 2 up is channel 3
  const varied={...report,states:{[id]:{...report.states[id],timer:different.toString('base64')}}};
  const mismatch=stateFrom(varied,id,env,now);
  assert.equal(mismatch.safetyMatches,false);
  assert.match(mismatch.safetyIssues.join(' '),/올림 7초 · 내림 6초/);
  for(const change of [{timer:null},{interlock:null},{up:null},{down:true},{online:false}]){
    const r={...report,states:{[id]:{...report.states[id],...change}}};
    assert.throws(()=>control.ensureReady(stateFrom(r,id,env,now)));
  }
  assert.throws(()=>control.ensureReady(stateFrom(report,id,env,now+91000)));
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
