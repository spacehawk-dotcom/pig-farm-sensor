const crypto = require('node:crypto');
const DEVICE = 'bfb4be1d3b42f4b899zcv2';
// Grower 2 read on 2026-10-22: channel 3 ON/5s, channel 2 ON/6s.
// Confirmed Smart Life configuration snapshot; never rewrite these settings.
const SAFETY = {switch_interlock:'AA8AAAAAAAA=',switch_inching:'AAAFAwAGBQAFBgAC'};
// Observed on grower 3/4 on 2026-10-20 and corrected grower 1 on 2026-10-21.
const CHANNEL_12_SAFETY = {switch_interlock:'AA8AAAAAAAA=',switch_inching:'AQAFAwAGBAACBgAC'};
// Add a batch only after verifying its device, channels, timer and safety settings.
// Each new batch must use its own commissioning environment variable.
const WINCHES = Object.freeze({
  '1': {deviceId:'bfc3bfc544f6c06e35jcn1',upChannel:'switch_1',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:CHANNEL_12_SAFETY,enabledEnv:'WINCH_1_SAFETY_CONFIRMED',haSensorKey:'육성_1배치'},
  '2': {deviceId:DEVICE,upChannel:'switch_3',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:SAFETY,enabledEnv:'WINCH_SAFETY_CONFIRMED',haSensorKey:'육성_2배치'},
  '3': {deviceId:'bf28266bf6b5528dc3jagu',upChannel:'switch_1',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:CHANNEL_12_SAFETY,enabledEnv:'WINCH_3_SAFETY_CONFIRMED',haSensorKey:'육성_3배치'},
  '4': {deviceId:'bf45e580cdc45371f4oeff',upChannel:'switch_1',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:CHANNEL_12_SAFETY,enabledEnv:'WINCH_4_SAFETY_CONFIRMED',haSensorKey:'육성_4배치'},
  '5': {deviceId:'bf5c24b61edbc6750cjw34',upChannel:'switch_1',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:null,enabledEnv:'WINCH_5_SAFETY_CONFIRMED',haSensorKey:'육성_5배치'},
  '6': {deviceId:'bf4f181985fcdb6b1fkddi',upChannel:'switch_1',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:null,enabledEnv:'WINCH_6_SAFETY_CONFIRMED',haSensorKey:'육성_6배치'},
  '7': {deviceId:'bf2fc7c86f8148ef80xom4',upChannel:'switch_1',downChannel:'switch_2',upSeconds:5,downSeconds:6,
    safety:null,enabledEnv:'WINCH_7_SAFETY_CONFIRMED',haSensorKey:'육성_7배치'}
});
const digest = value => crypto.createHash('sha256').update(value).digest();
const fail = (message, status=409) => Object.assign(new Error(message),{status});

function createDeviceControl({env,request,registry=WINCHES,sleep=ms=>new Promise(r=>setTimeout(r,ms))}) {
  const getState=async(id,diagnostic=false)=>{
    const config=registry[id];
    const detail=await request('GET',`/v1.0/devices/${config.deviceId}`);
    const values=Object.fromEntries((detail.status||[]).map(s=>[s.code,s.value]));
    return {batchId:id,upSeconds:config.upSeconds,downSeconds:config.downSeconds,
      online:detail.online===true,up:values[config.upChannel],down:values[config.downChannel],
      safetyMatches:!!config.safety&&Object.keys(config.safety).length>0&&Object.entries(config.safety).every(([key,value])=>values[key]===value),
      ...(diagnostic?{safetySnapshot:{switch_interlock:values.switch_interlock??null,switch_inching:values.switch_inching??null}}:{}),
      enabled:env[config.enabledEnv]==='true',checkedAt:Date.now()};
  };
  const ensureReady=state=>{
    if(!state.enabled)throw fail('관리자의 현장 확인 후 서버에서 제어를 활성화해야 합니다.');
    if(!state.online)throw fail('장치가 오프라인입니다.');
    if(!state.safetyMatches)throw fail('장치의 상호잠금·자동 꺼짐 설정이 확인된 값과 다릅니다. Smart Life 설정을 확인하세요.');
    if(state.up!==false||state.down!==false)throw fail('동작 중이거나 상태가 불확실합니다. 정지 후 상태를 확인하세요.');
  };
  // Caller must hold the shared per-batch lock, for both manual and automatic commands.
  const move=async(action,id)=>{
    const config=registry[id],path=`/v1.0/devices/${config.deviceId}`;
    if(action!=='stop')ensureReady(await getState(id));
    const send=async commands=>{
      if(await request('POST',path+'/commands',{commands})!==true)throw fail('Tuya가 명령을 수락하지 않았습니다.',502);
    };
    await send([{code:config.downChannel,value:false},{code:config.upChannel,value:false}]);
    if(action!=='stop'){
      await sleep(600);
      ensureReady(await getState(id));
      await send([{code:action==='up'?config.upChannel:config.downChannel,value:true}]);
    }
    return {accepted:true,action,batchId:id,message:action==='stop'?'정지 명령 전달됨 · 실제 상태 확인 중':'동작 명령 전달됨 · 실제 상태 확인 중'};
  };
  return {getState,ensureReady,move};
}

function createHandler({env, request, withLock, sleep, automation,registry=WINCHES}) {
  const control=createDeviceControl({env,request,sleep,registry});
  const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
  return async event=>{
    if(event.httpMethod!=='POST')return reply(405,{error:'POST 요청만 지원합니다.'});
    const password=env.WINCH_CONTROL_PASSWORD || '';
    if(password.length<10||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))return reply(503,{error:'서버의 윈치 제어 비밀번호는 영문과 숫자를 포함한 10자 이상이어야 합니다.'});
    const supplied=event.headers?.['x-winch-password'] || '';
    if(typeof supplied!=='string'||!crypto.timingSafeEqual(digest(supplied),digest(password)))return reply(401,{error:'제어 비밀번호를 확인하세요.'});
    let action,batchId,stage;
    try{({action,batchId,stage}=JSON.parse(event.body||'{}'));}catch{return reply(400,{error:'요청 형식 오류'});}
    if(!['status_all','status','up','down','stop','auto_status','auto_on','auto_off','diagnostics'].includes(action))return reply(400,{error:'지원하지 않는 동작입니다.'});
    // Preserve requests from the previous single-winch UI during deployment.
    if(batchId===undefined)batchId='2';
    if(!['string','number'].includes(typeof batchId)||!Object.hasOwn(registry,String(batchId)))
      return reply(404,{error:'이 배치에는 윈치가 등록되지 않았습니다.'});
    batchId=String(batchId);
    try{
      const getBatchState=async id=>{
        const state=await control.getState(id);
        if(automation)state.auto=await automation.status(id);
        return state;
      };
      if(action==='status_all'){
        const batches={};
        await Promise.all(Object.keys(registry).map(async id=>{
          const config=registry[id];
          try{batches[id]=await getBatchState(id);}
          catch(error){batches[id]={batchId:id,upSeconds:config.upSeconds,downSeconds:config.downSeconds,error:error.status?error.message:'장치 상태를 확인하지 못했습니다.'};}
        }));
        return reply(200,{batches});
      }
      if(action==='status')return reply(200,await getBatchState(batchId));
      if(action==='diagnostics'){
        const state=await control.getState(batchId,true);
        await withLock('diagnostics',async()=>{},batchId);
        return reply(200,{state,message:'장치 상태 조회와 서버 잠금 읽기·쓰기 정상. 실제 동작 명령은 보내지 않았습니다.'});
      }
      if(action.startsWith('auto_')){
        if(!automation)throw fail('자동 운전 서버가 준비되지 않았습니다.',503);
        if(action==='auto_status')return reply(200,await automation.probe(batchId));
        if(action==='auto_on')return reply(200,await automation.enable(batchId,stage));
        return reply(200,await automation.manual('stop',batchId));
      }
      const result=automation ? await automation.manual(action,batchId) :
        await withLock(action,()=>control.move(action,batchId),batchId);
      return reply(200,result);
    }catch(e){return reply(e.status||502,{error:e.status?e.message:'장치 연결 또는 명령 결과를 확인하지 못했습니다. 자동으로 재전송하지 않습니다. 상태를 확인하세요.'});}
  };
}
module.exports={createHandler,createDeviceControl,DEVICE,SAFETY,WINCHES};
