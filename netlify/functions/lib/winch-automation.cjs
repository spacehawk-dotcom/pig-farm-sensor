const {MAX_SAMPLE_AGE}=require('./winch-ha-temperature.cjs');
const MIN_COMMAND_INTERVAL=5*60*1000;
const fail=message=>Object.assign(new Error(message),{status:409});
const SCHEMA_VERSION=3;
function normalizedState(state){
  if(state?.schemaVersion===SCHEMA_VERSION)return state;
  // Preserve an explicit pause and uncertain commands during migration.
  return {enabled:state?.enabled!==false,paused:!state||state.paused!==false,
    pending:state?.pending||null,schemaVersion:SCHEMA_VERSION,referenceTemperature:null,
    reason:'온도 변화 감시 대기',lastActionAt:state?.lastActionAt||0};
}
function nextAction(previous,temperature,settings){
  if(!Number.isFinite(previous)||!Number.isFinite(temperature)||
    settings?.up?.length!==3||settings?.down?.length!==3)return null;
  if(settings.up.some(t=>previous<t&&temperature>=t))return {action:'up'};
  if(settings.down.some(t=>previous>t&&temperature<=t))return {action:'down'};
  return null;
}
const sameThresholds=(a,b)=>JSON.stringify([a?.up,a?.down])===JSON.stringify([b?.up,b?.down]);

function createAutomation({readTemperature,readSettings,control,withLock,store,now=Date.now}){
  const status=async id=>normalizedState(await store.read(id));
  const probe=async id=>{
    const auto=await status(id);
    const result={auto};
    try{result.sample=await readTemperature(id);}
    catch(error){result.sensorError=error.status?error.message:'온도 센서 연결을 확인하지 못했습니다.';}
    try{result.settings=await readSettings(id);}
    catch(error){result.settingsError=error.status?error.message:'1그룹 설정온도를 읽지 못했습니다.';}
    return result;
  };
  const enable=async(id)=>{
    return withLock('auto_on',async()=>{
      const old=await status(id);
      if(old.enabled&&!old.paused)throw fail('이미 자동 운전 중입니다.');
      control.ensureReady(await control.getState(id));
      const sample=await readTemperature(id);
      const settings=await readSettings(id);
      const auto={enabled:true,paused:false,schemaVersion:SCHEMA_VERSION,referenceTemperature:sample.temperature,pending:null,
        reason:'자동 운전 대기 · 5분 후부터 확인',...sample,settings,controlSource:control.source||null,checkedAt:now(),lastActionAt:now()};
      await store.write(id,auto);
      return {auto,message:'자동 운전을 설정했습니다. 다음 서버 확인부터 온도 기준을 적용합니다.'};
    },id);
  };
  const manual=(action,id)=>withLock(action,async()=>{
    if(!['up','down','stop'].includes(action))throw fail('지원하지 않는 수동 동작입니다.');
    const pausedState=reason=>({enabled:true,paused:true,schemaVersion:SCHEMA_VERSION,
      referenceTemperature:null,pending:null,reason,checkedAt:now(),lastActionAt:now()});
    if(action==='stop'){
      // Even when storage is unavailable, send only OFF. Automatic operation remains paused until resumed.
      let persistenceError;
      try{await store.write(id,pausedState('사용자가 정지함 · 자동 시작·재개로 다시 시작'));}
      catch(error){persistenceError=error;}
      const result=await control.move('stop',id);
      if(persistenceError)throw fail('정지 명령은 전달했으나 자동 보류 저장에 실패했습니다. 자동 상태를 다시 확인하세요.');
      return {...result,message:'자동 보류 · '+result.message};
    }
    const old=await status(id);
    // Persist the baseline reset before dispatch; preserve the operator's mode.
    const intent={...old,pending:null,referenceTemperature:null,lastActionAt:now(),checkedAt:now()};
    const mode=old.enabled&&!old.paused?'자동 감시 유지':'기존 운전 모드 유지';
    await store.write(id,{...intent,reason:'수동 신호 전송 시도 · '+mode});
    let result;
    try{result=await control.move(action,id);}
    catch(error){
      await store.write(id,{...intent,reason:'수동 신호 전송 미확인 · '+mode});
      throw error;
    }
    const reason='수동 신호 전달 · '+mode;
    await store.write(id,{...intent,lastAction:action,reason});
    return {...result,message:reason};
  },id);
  const tick=id=>withLock('automatic',async()=>{
    let auto=await status(id);
    if(auto.pending){
      // Discard an old in-flight ticket without replaying it or changing the operator's mode.
      await store.write(id,{...auto,referenceTemperature:null,pending:null,
        reason:'이전 신호 재전송 없이 기존 모드 유지',checkedAt:now()});
      return;
    }
    if(!auto.enabled||auto.paused)return;
    if(now()-auto.lastActionAt<MIN_COMMAND_INTERVAL)return;
    let sample,settings;
    try{
      sample=await readTemperature(id);
      settings=await readSettings(id);
    }catch(error){
      await store.write(id,{...auto,reason:error.status?error.message:'장치 연결 실패 · 자동 대기',checkedAt:now()});
      return;
    }
    // First sample, settings changes and manual moves establish a fresh baseline.
    const sameSource=!control.source || control.source===auto.controlSource;
    const next=sameSource && sameThresholds(auto.settings,settings)?nextAction(auto.referenceTemperature,sample.temperature,settings):null;
    auto={...auto,...sample,settings,controlSource:control.source||null,referenceTemperature:sample.temperature,checkedAt:now()};
    if(!next){await store.write(id,{...auto,reason:'기준 온도 대기'});return;}
    // Write the intent BEFORE I/O. A timeout/crash must never replay a movement.
    const intent={...auto,pending:null,lastActionAt:now(),reason:'자동 신호 전송 시도'};
    await store.write(id,intent);
    try{await control.move(next.action,id);}
    catch(error){
      await store.write(id,{...intent,reason:(error.status?error.message:'신호 전송 미확인')+' · 자동 감시 유지'});
      return;
    }
    await store.write(id,{...intent,lastAction:next.action,
      reason:`${sample.temperature}℃ · ${next.action==='up'?'올림 5초':'내림 6초'} 신호 전달`});
  },id);
  return {status,probe,enable,manual,tick};
}
module.exports={createAutomation,nextAction,MAX_SAMPLE_AGE,MIN_COMMAND_INTERVAL};
