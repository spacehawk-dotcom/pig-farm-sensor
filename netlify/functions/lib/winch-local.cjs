const crypto=require('node:crypto');
const {WINCHES}=require('./winch-control');
const freshMs=90000,validMs=10000;
const batchOK=id=>typeof id==='string' && Object.hasOwn(WINCHES,id);
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const workerHash='3d81e6a1f5008de48759d660bbb1aaea053fdf7a0a00e6cebf35bdf9fde47321';
const authenticated=token=>typeof token==='string' && crypto.timingSafeEqual(
  crypto.createHash('sha256').update(token).digest(),Buffer.from(workerHash,'hex'));
const sign=(session,id,ticket)=>crypto.createHmac('sha256',session).update(id+':'+ticket).digest('hex');
const signPayload=(session,payload)=>crypto.createHmac('sha256',session).update(payload).digest('hex');
const mailbox=(db,id)=>db.doc('winch_server_locks/ha_command_'+id);
const worker=db=>db.doc('winch_server_locks/ha_local_status');
const signalHistory=message=>Array.isArray(message?.history)?message.history.slice(0,20):[];

function timerDetail(raw,cfg){
  if(typeof raw!=='string')return '';
  const bytes=Buffer.from(raw,'base64'),timers=new Map();
  if(!bytes.length||bytes.length%3||bytes.toString('base64')!==raw)return '';
  for(let i=0;i<bytes.length;i+=3){
    const ch='switch_'+((bytes[i]>>1)+1);
    if(timers.has(ch))return '';
    timers.set(ch,(bytes[i]&1)?bytes.readUInt16BE(i+1)+'초':'꺼짐');
  }
  return ' (올림 '+(timers.get(cfg.upChannel)||'미보고')+' · 내림 '+(timers.get(cfg.downChannel)||'미보고')+')';
}

function stateFrom(report,id,env,now=Date.now(),diagnostic=false){
  const cfg=WINCHES[id], s=report?.states?.[id];
  const bridgeFresh=Number.isFinite(report?.receivedAt) && now-report.receivedAt<freshMs && now>=report.receivedAt;
  const online=bridgeFresh && s?.online===true && typeof s.up==='boolean' && typeof s.down==='boolean';
  const snap={switch_inching:s?.timer??null};
  return {batchId:id,source:'ha-localtuya',checkedAt:report?.receivedAt||0,upSeconds:cfg.upSeconds,downSeconds:cfg.downSeconds,
    enabled:env[cfg.enabledEnv]==='true',bridgeFresh,online,up:online?s.up:null,down:online?s.down:null,
    safetyMatches:online && snap.switch_inching===cfg.safety.switch_inching,
    safetyIssues:online && snap.switch_inching!==cfg.safety.switch_inching?
      ['자동 꺼짐'+(snap.switch_inching==null?' 응답 없음':' 설정 불일치')+timerDetail(snap.switch_inching,cfg)]:[],
    ...(diagnostic?{safetySnapshot:snap}:{})};
}
function ensureReady(s){
  if(!s.enabled)throw fail('배치 제어가 활성화되지 않았습니다.');
}
function waitResult(ref,ticket,timeout){
  return new Promise((resolve,reject)=>{
    const done=(fn,value)=>{clearTimeout(timer);unsubscribe();fn(value);};
    let unsubscribe=()=>{};
    const timer=setTimeout(()=>done(resolve,null),timeout);
    unsubscribe=ref.onSnapshot(doc=>{
      const m=doc.data();
      if(m?.ticket===ticket && m.phase==='done'){
        done(resolve,m.ok);
      }
    },()=>done(reject,fail('HA 명령 확인 연결이 끊겼습니다.',502)));
  });
}
function createLocalControl({database,env,notify}){
  let report;
  const read=()=>report??=worker(database()).get().then(d=>d.data());
  const getState=async(id,diagnostic=false)=>{
    const [status,commands]=await Promise.all([read(),mailbox(database(),id).get()]);
    const history=[...signalHistory(commands.data()),...signalHistory({history:status?.autoHistory?.[id]})]
      .sort((a,b)=>b.at-a.at).slice(0,20);
    return {...stateFrom(status,id,env,Date.now(),diagnostic),signalHistory:history};
  };
  const move=async(action,id,context={})=>{
    if(!batchOK(id)||!['up','down','stop','check','resume'].includes(action))throw fail('허용되지 않은 윈치 명령입니다.');
    const r=await read(),s=stateFrom(r,id,env);
    if(['up','down','resume'].includes(action))ensureReady(s);
    if(action==='resume' && r?.protocol!==2)throw fail('HA 자동 운전 업데이트가 필요합니다.');
    if(!r?.session)throw fail('농장 HA에 등록된 신호 수신 세션이 없습니다.');
    const ref=mailbox(database(),id);
    // The caller holds the batch lock. Never overwrite a live, unconsumed ticket.
    const previous=(await ref.get()).data();
    if(previous?.session===r.session && previous.phase!=='done'){
      const remaining=previous.expires+3500-Date.now();
      if(remaining>0){
        if(action!=='stop')throw fail('이 배치의 앞선 신호를 처리 중입니다.');
        await waitResult(ref,previous.ticket,remaining);
      }
    }
    const ticket=crypto.randomUUID(),expires=Date.now()+validMs;
    const priorHistory=signalHistory(previous);
    const event={at:Date.now(),action,mode:context.mode==='auto'?'auto':'manual',status:'registered',
      ...(Number.isFinite(context.temperature)?{temperature:context.temperature}:{})};
    const history=['check','resume'].includes(action)?priorHistory:[event,...priorHistory].slice(0,20);
    await ref.set({action,ticket,expires,session:r.session,phase:'waiting',history,protocol:r.protocol===2?2:1});
    // This public RTDB leaf is only a signed wake-up. It cannot authorize a command.
    if(r.protocol===2){
      const payload=JSON.stringify({v:2,id,ticket,action,expires,...(context.settings?{settings:context.settings}:{})});
      await notify(id,{payload,mac:signPayload(r.session,payload)});
    }else await notify(id,{ticket,mac:sign(r.session,id,ticket)});
    if(!['check','resume'].includes(action)){
      event.status='sent';
      // Updating only history preserves any concurrent HA claim or acknowledgement.
      await ref.update({history});
    }
    if((action==='check'||r.protocol===2&&['resume','stop'].includes(action)) &&
       !await waitResult(ref,ticket,Math.max(1,expires-Date.now()+3500))){
      throw fail(action==='check'?'HA 연결 진단 응답을 받지 못했습니다.':'HA 설정 요청 응답을 받지 못했습니다. 상태를 다시 확인하세요.',504);
    }
    return {accepted:true,batchId:id,action,signalHistory:history,
      message:action==='check'?'HA 연결 진단 완료':'신호 요청을 보냈습니다.'};
  };
  return {source:'ha-localtuya/signals',getState,ensureReady,move,check:id=>move('check',id)};
}
async function workerApi(db,body){
  const {op,session,id,ticket}=body;
  if(typeof session!=='string'||!/^[0-9a-f]{64}$/.test(session))throw fail('invalid session',400);
  if(op==='report'){
    const states={};
    for(const id of Object.keys(WINCHES)){
      const s=body.states?.[id];
      if(!s||typeof s.online!=='boolean'||[s.up,s.down].some(v=>v!==null&&typeof v!=='boolean')||
        (s.timer!==null&&(typeof s.timer!=='string'||s.timer.length>128)))throw fail('invalid state',400);
      states[id]={online:s.online,up:s.up,down:s.down,timer:s.timer};
    }
    const extra=body.protocol===2?{protocol:2,autos:body.autos||{},autoHistory:body.autoHistory||{},temperatures:body.temperatures||{}}:{};
    if(JSON.stringify(extra).length>48000)throw fail('report too large',400);
    await worker(db).set({session,states,receivedAt:Date.now(),...extra});
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
    if((m.phase==='claimed'||m.protocol===2&&m.phase==='waiting') && typeof body.ok==='boolean')
      tx.update(ref,{phase:'done',ok:body.ok,...(m.protocol===2&&body.auto&&JSON.stringify(body.auto).length<4096?{auto:body.auto}:{})});
    return {ok:true};
  });
}
module.exports={createLocalControl,workerApi,authenticated,stateFrom,sign,signPayload};
