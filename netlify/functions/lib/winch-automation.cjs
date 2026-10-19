const MAX_SAMPLE_AGE=15*60*1000;
const MIN_COMMAND_INTERVAL=5*60*1000;
const fail=message=>Object.assign(new Error(message),{status:409});
const validStage=stage=>Number.isInteger(stage)&&stage>=0&&stage<=2;

// Stage is a record of timed commands, never a measured physical position.
function nextAction(stage,temperature){
  if(!validStage(stage)||!Number.isFinite(temperature))return null;
  if(stage===0&&temperature>=24.3)return {action:'up',stage:1};
  if(stage===1&&temperature>=27)return {action:'up',stage:2};
  if(stage===2&&temperature<=23.7)return {action:'down',stage:1};
  if(stage===1&&temperature<=21)return {action:'down',stage:0};
  return null;
}

function parseTemperature(detail,shadow,specification,now){
  if(detail.online!==true)throw fail('온도 센서 오프라인 · 자동 대기');
  const codes=['va_temperature','temp_current','temperature'];
  const properties=(shadow.properties||[]).filter(p=>codes.includes(p.code));
  if(properties.length!==1)throw fail('자동 운전용 온도 항목을 확인하지 못했습니다.');
  const property=properties[0];
  const spec=(specification.status||[]).find(s=>s.code===property.code);
  let values;
  try{values=typeof spec?.values==='string'?JSON.parse(spec.values):spec?.values;}catch{}
  if(!values||!['℃','°C','C','c'].includes(values.unit)||!Number.isInteger(values.scale)||values.scale<0||values.scale>3)
    throw fail('온도 단위와 소수점 배율을 확인하지 못했습니다.');
  const temperature=property.value/10**values.scale,measuredAt=property.time;
  if(typeof property.value!=='number'||!Number.isFinite(temperature)||temperature< -40||temperature>80)
    throw fail('온도 측정값 오류 · 자동 대기');
  if(typeof measuredAt!=='number'||!Number.isFinite(measuredAt)||measuredAt<=0||now-measuredAt>MAX_SAMPLE_AGE||measuredAt>now+30000)
    throw fail('온도 갱신이 15분 이상 지연되었거나 측정 시간이 불확실합니다.');
  return {temperature,measuredAt};
}

function createAutomation({registry,request,control,withLock,store,now=Date.now}){
  const status=async id=>await store.read(id)||{enabled:false,stage:null,reason:'수동 모드'};
  const readTemperature=async id=>{
    const sensor=registry[id].sensorId;
    if(!sensor)throw fail('이 배치의 자동 운전용 온도 센서가 등록되지 않았습니다.');
    const [detail,spec]=await Promise.all([
      request('GET',`/v1.0/devices/${sensor}`),
      request('GET',`/v1.0/devices/${sensor}/specifications`)
    ]);
    let shadow;
    try{shadow=await request('GET',`/v2.0/cloud/thing/${sensor}/shadow/properties`);}
    catch(error){
      if(error.tuyaCode!=='28841105')throw error;
      // Some Smart Home projects expose reporting logs but not the newer shadow API.
      // Keep the actual device-reported timestamp; never substitute the request time.
      const end=now(),codes=['va_temperature','temp_current','temperature'];
      // Tuya signs the query string with parameter keys in alphabetical order.
      const result=await request('GET',`/v1.0/iot-03/devices/${sensor}/report-logs?codes=${codes.join(',')}&end_time=${end}&size=100&start_time=${end-MAX_SAMPLE_AGE}`);
      const logs=(result.logs||result.list||[]).filter(log=>codes.includes(log.code)&&typeof log.event_time==='number').sort((a,b)=>b.event_time-a.event_time);
      if(!logs.length)throw fail('최근 15분의 온도 보고 기록이 없어 자동 운전을 대기합니다.');
      const latest=logs[0],value=typeof latest.value==='string'&&/^-?\d+(\.\d+)?$/.test(latest.value)?Number(latest.value):latest.value;
      shadow={properties:[{code:latest.code,value,time:latest.event_time}]};
    }
    return parseTemperature(detail,shadow,spec,now());
  };
  const probe=async id=>{
    const auto=await status(id);
    try{return {auto,sample:await readTemperature(id)};}
    catch(error){return {auto,sensorError:error.status?error.message:'온도 센서 연결을 확인하지 못했습니다.'};}
  };
  const enable=async(id,stage)=>{
    if(!validStage(stage))throw fail('현장에서 확인한 현재 단계(0·1·2)를 선택하세요.');
    return withLock('auto_on',async()=>{
      const old=await status(id);
      if(old.enabled)throw fail('이미 자동 운전 중입니다. 단계를 변경하려면 자동 해제·정지를 먼저 누르세요.');
      control.ensureReady(await control.getState(id));
      const sample=await readTemperature(id);
      const auto={enabled:true,stage,pending:null,reason:'자동 운전 대기 · 5분마다 확인',...sample,checkedAt:now(),lastActionAt:0};
      await store.write(id,auto);
      return {auto,message:'자동 운전을 설정했습니다. 다음 서버 확인부터 온도 기준을 적용합니다.'};
    },id);
  };
  const manual=(action,id)=>withLock(action,async()=>{
    // Persist cancellation before any manual move so later scheduled ticks cannot undo it.
    let persistenceError;
    try{await store.write(id,{enabled:false,stage:null,pending:null,reason:'수동 조작으로 자동 해제',checkedAt:now()});}
    catch(error){if(action!=='stop')throw error;persistenceError=error;}
    const result=await control.move(action,id);
    if(persistenceError)throw fail('정지 명령은 전달했으나 자동 해제 저장에 실패했습니다. 자동 상태를 다시 확인하세요.');
    return {...result,message:'자동 해제 · '+result.message};
  },id);
  const tick=id=>withLock('automatic',async()=>{
    let auto=await status(id);
    if(!auto.enabled)return;
    if(auto.pending||!validStage(auto.stage)){
      await store.write(id,{...auto,enabled:false,stage:null,pending:null,reason:'이전 명령 결과 불확실 · 현장 확인 후 다시 시작',checkedAt:now()});
      return;
    }
    if(now()-auto.lastActionAt<MIN_COMMAND_INTERVAL)return;
    let sample;
    try{
      sample=await readTemperature(id);
      control.ensureReady(await control.getState(id));
    }catch(error){
      await store.write(id,{...auto,reason:error.status?error.message:'장치 연결 실패 · 자동 대기',checkedAt:now()});
      return;
    }
    auto={...auto,...sample,checkedAt:now()};
    const next=nextAction(auto.stage,sample.temperature);
    if(!next){await store.write(id,{...auto,reason:'기준 온도 대기'});return;}
    // Write the intent BEFORE I/O. A timeout/crash must never replay a movement.
    const pending={action:next.action,targetStage:next.stage,at:now()};
    await store.write(id,{...auto,pending,reason:'자동 명령 처리 중'});
    try{
      await control.move(next.action,id);
      await store.write(id,{...auto,stage:next.stage,pending:null,lastAction:next.action,lastActionAt:now(),
        reason:`${sample.temperature}℃ · ${next.action==='up'?'올림 5초':'내림 6초'} 명령 전달`});
    }catch{
      // Do not retry an uncertain Tuya command, including when the final state write failed.
      await store.write(id,{...auto,enabled:false,stage:null,pending:null,reason:'명령 결과 불확실 · 현장 확인 후 다시 시작',checkedAt:now()});
    }
  },id);
  return {status,probe,enable,manual,tick};
}
module.exports={createAutomation,nextAction,parseTemperature,MAX_SAMPLE_AGE,MIN_COMMAND_INTERVAL};
