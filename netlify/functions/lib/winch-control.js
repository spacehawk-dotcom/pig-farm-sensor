const crypto = require('node:crypto');
const DEVICE = 'bfb4be1d3b42f4b899zcv2';
// Confirmed Smart Life configuration snapshot; never rewrite these settings.
const SAFETY = {switch_interlock:'AA8AAAAAAAA=',switch_inching:'AAACAwAHBQAIBgAC'};
// Add a batch only after verifying its device, channels, timer and safety settings.
// Each new batch must use its own commissioning environment variable.
const WINCHES = Object.freeze({
  '2': {deviceId:DEVICE,upChannel:'switch_3',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:SAFETY,enabledEnv:'WINCH_SAFETY_CONFIRMED'}
});
const digest = value => crypto.createHash('sha256').update(value).digest();
const fail = (message, status=409) => Object.assign(new Error(message),{status});

function createHandler({env, request, withLock, sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
  return async event=>{
    if(event.httpMethod!=='POST')return reply(405,{error:'POST 요청만 지원합니다.'});
    const password=env.WINCH_CONTROL_PASSWORD || '';
    if(password.length<10||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))return reply(503,{error:'서버의 윈치 제어 비밀번호는 영문과 숫자를 포함한 10자 이상이어야 합니다.'});
    const supplied=event.headers?.['x-winch-password'] || '';
    if(typeof supplied!=='string'||!crypto.timingSafeEqual(digest(supplied),digest(password)))return reply(401,{error:'제어 비밀번호를 확인하세요.'});
    let action,batchId;
    try{({action,batchId}=JSON.parse(event.body||'{}'));}catch{return reply(400,{error:'요청 형식 오류'});}
    if(!['status_all','status','up','down','stop'].includes(action))return reply(400,{error:'지원하지 않는 동작입니다.'});
    // Preserve requests from the previous single-winch UI during deployment.
    if(batchId===undefined)batchId='2';
    if(!['string','number'].includes(typeof batchId)||!Object.hasOwn(WINCHES,String(batchId)))
      return reply(404,{error:'이 배치에는 윈치가 등록되지 않았습니다.'});
    batchId=String(batchId);
    try{
      const getBatchState=async id=>{
        const config=WINCHES[id];
        const detail=await request('GET',`/v1.0/devices/${config.deviceId}`);
        const values=Object.fromEntries((detail.status||[]).map(s=>[s.code,s.value]));
        return {batchId:id,upSeconds:config.upSeconds,downSeconds:config.downSeconds,
          online:detail.online===true,up:values[config.upChannel],down:values[config.downChannel],
          safetyMatches:Object.entries(config.safety).every(([key,value])=>values[key]===value),
          enabled:env[config.enabledEnv]==='true',checkedAt:Date.now()};
      };
      if(action==='status_all'){
        const batches={};
        await Promise.all(Object.keys(WINCHES).map(async id=>{
          const config=WINCHES[id];
          try{batches[id]=await getBatchState(id);}
          catch{batches[id]={batchId:id,upSeconds:config.upSeconds,downSeconds:config.downSeconds,error:'장치 상태를 확인하지 못했습니다.'};}
        }));
        return reply(200,{batches});
      }
      const config=WINCHES[batchId],PATH=`/v1.0/devices/${config.deviceId}`;
      const OFF=[{code:config.downChannel,value:false},{code:config.upChannel,value:false}];
      const getState=()=>getBatchState(batchId);
      if(action==='status')return reply(200,await getState());
      const result=await withLock(action,async()=>{
        if(action!=='stop'){
          const state=await getState();
          if(!state.enabled)throw fail('관리자의 현장 확인 후 서버에서 제어를 활성화해야 합니다.');
          if(!state.online)throw fail('장치가 오프라인입니다.');
          if(!state.safetyMatches)throw fail('장치의 상호잠금·자동 꺼짐 설정이 확인된 값과 다릅니다. Smart Life 설정을 확인하세요.');
          if(state.up!==false||state.down!==false)throw fail('동작 중이거나 상태가 불확실합니다. 정지 후 상태를 확인하세요.');
        }
        const send=async commands=>{
          if(await request('POST',PATH+'/commands',{commands})!==true)throw fail('Tuya가 명령을 수락하지 않았습니다.',502);
        };
        await send(OFF);
        if(action!=='stop'){
          await sleep(600);
          const stopped=await getState();
          if(!stopped.online||!stopped.safetyMatches||stopped.up!==false||stopped.down!==false)throw fail('양방향 OFF 확인에 실패해 동작을 취소했습니다.');
          await send([{code:action==='up'?config.upChannel:config.downChannel,value:true}]);
        }
        return {accepted:true,action,batchId,message:action==='stop'?'정지 명령 전달됨 · 실제 상태 확인 중':'동작 명령 전달됨 · 실제 상태 확인 중'};
      },batchId);
      return reply(200,result);
    }catch(e){return reply(e.status||502,{error:e.status?e.message:'장치 연결 또는 명령 결과를 확인하지 못했습니다. 자동으로 재전송하지 않습니다. 상태를 확인하세요.'});}
  };
}
module.exports={createHandler,DEVICE,SAFETY,WINCHES};
