const crypto=require('node:crypto');
const {WINCHES}=require('./winch-control');
const freshMs=90000,validMs=10000;
const batchOK=id=>typeof id==='string' && Object.hasOwn(WINCHES,id);
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const workerHash='3d81e6a1f5008de48759d660bbb1aaea053fdf7a0a00e6cebf35bdf9fde47321';
const authenticated=token=>typeof token==='string' && crypto.timingSafeEqual(
  crypto.createHash('sha256').update(token).digest(),Buffer.from(workerHash,'hex'));
const sign=(session,id,ticket)=>crypto.createHmac('sha256',session).update(id+':'+ticket).digest('hex');
const mailbox=(db,id)=>db.doc('winch_server_locks/ha_command_'+id);
const worker=db=>db.doc('winch_server_locks/ha_local_status');

function stateFrom(report,id,env,now=Date.now(),diagnostic=false){
  const cfg=WINCHES[id], s=report?.states?.[id];
  const online=Number.isFinite(report?.receivedAt) && now-report.receivedAt<freshMs &&
    now>=report.receivedAt && s?.online===true && typeof s.up==='boolean' && typeof s.down==='boolean';
  const snap={switch_interlock:s?.interlock??null,switch_inching:s?.timer??null};
  return {batchId:id,source:'ha-localtuya',checkedAt:report?.receivedAt||0,upSeconds:cfg.upSeconds,downSeconds:cfg.downSeconds,
    enabled:env[cfg.enabledEnv]==='true',online,up:online?s.up:null,down:online?s.down:null,
    safetyMatches:online && Object.entries(cfg.safety).every(([k,v])=>snap[k]===v),
    ...(diagnostic?{safetySnapshot:snap}:{})};
}
function ensureReady(s){
  if(!s.enabled)throw fail('배치 제어가 활성화되지 않았습니다.');
  if(!s.online)throw fail('HA 로컬 연결 또는 채널 상태를 확인할 수 없습니다.');
  if(!s.safetyMatches)throw fail('HA에서 상호잠금·자동 꺼짐을 확인하지 못했습니다. 안전 설정을 확인하세요.');
  if(s.up!==false||s.down!==false)throw fail('윈치가 동작 중이거나 상태가 불확실합니다.');
}
function waitResult(ref,ticket,timeout){
  return new Promise((resolve,reject)=>{
    const done=(fn,value)=>{clearTimeout(timer);unsubscribe();fn(value);};
    let unsubscribe=()=>{};
    const timer=setTimeout(()=>done(reject,fail('HA 명령 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다.',504)),timeout);
    unsubscribe=ref.onSnapshot(doc=>{
      const m=doc.data();
      if(m?.ticket===ticket && m.phase==='done'){
        if(m.ok)done(resolve,true);
        else done(reject,fail('HA가 윈치 명령을 완료하지 못했습니다. 장치와 안전 설정을 확인하세요.'));
      }
    },()=>done(reject,fail('HA 명령 확인 연결이 끊겼습니다.',502)));
  });
}
function createLocalControl({database,env,notify}){
  let report;
  const read=()=>report??=worker(database()).get().then(d=>d.data());
  const getState=async(id,diagnostic=false)=>stateFrom(await read(),id,env,Date.now(),diagnostic);
  const move=async(action,id)=>{
    if(!batchOK(id)||!['up','down','stop','check'].includes(action))throw fail('허용되지 않은 윈치 명령입니다.');
    const r=await read(),s=stateFrom(r,id,env);
    if(['up','down'].includes(action))ensureReady(s);
    if(!r?.session||Date.now()-r.receivedAt>=freshMs)throw fail('농장 HA 연결이 끊겼습니다.');
    const ref=mailbox(database(),id),ticket=crypto.randomUUID(),expires=Date.now()+validMs;
    await ref.set({action,ticket,expires,session:r.session,phase:'waiting'});
    // This public RTDB leaf is only a signed wake-up. It cannot authorize a command.
    await notify(id,{ticket,mac:sign(r.session,id,ticket)});
    await waitResult(ref,ticket,Math.max(1,expires-Date.now()+3500));
    return {accepted:true,batchId:id,action,message:'HA 로컬 채널에서 명령을 확인했습니다.'};
  };
  return {source:'ha-localtuya',getState,ensureReady,move,check:id=>move('check',id)};
}
async function workerApi(db,body){
  const {op,session,id,ticket}=body;
  if(typeof session!=='string'||!/^[0-9a-f]{64}$/.test(session))throw fail('invalid session',400);
  if(op==='report'){
    for(const id of Object.keys(WINCHES)){
      const s=body.states?.[id];
      if(!s||typeof s.online!=='boolean'||[s.up,s.down].some(v=>v!==null&&typeof v!=='boolean')||
        [s.timer,s.interlock].some(v=>v!==null&&(typeof v!=='string'||v.length>128)))throw fail('invalid state',400);
    }
    await worker(db).set({session,states:body.states,receivedAt:Date.now()});
    return {ok:true};
  }
  if(!batchOK(id)||typeof ticket!=='string'||!/^[a-f0-9-]{36}$/.test(ticket)||!['claim','ack'].includes(op))throw fail('invalid message',400);
  const ref=mailbox(db,id);
  return db.runTransaction(async tx=>{
    const m=(await tx.get(ref)).data();
    if(m?.ticket!==ticket||m.session!==session)return {command:null};
    if(op==='claim'){
      if(m.phase!=='waiting'||Date.now()>=m.expires)return {command:null};
      tx.update(ref,{phase:'claimed'});
      return {command:{action:m.action,expires:m.expires}};
    }
    if(m.phase==='claimed' && typeof body.ok==='boolean')tx.update(ref,{phase:'done',ok:body.ok});
    return {ok:true};
  });
}
module.exports={createLocalControl,workerApi,authenticated,stateFrom,sign};
