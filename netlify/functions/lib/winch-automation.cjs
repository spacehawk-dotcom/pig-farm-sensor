const {MAX_SAMPLE_AGE}=require('./winch-ha-temperature.cjs');
const MIN_COMMAND_INTERVAL=5*60*1000;
const fail=message=>Object.assign(new Error(message),{status:409});
const validStage=stage=>Number.isInteger(stage)&&stage>=0&&stage<=2;

// Stage is a record of timed commands, never a measured physical position.
function nextAction(stage,temperature,settings){
  if(!validStage(stage)||!Number.isFinite(temperature)||!settings)return null;
  if(stage===0&&temperature>=settings.up1)return {action:'up',stage:1};
  if(stage===1&&temperature>=settings.up2)return {action:'up',stage:2};
  if(stage===2&&temperature<=settings.down1)return {action:'down',stage:1};
  if(stage===1&&temperature<=settings.down0)return {action:'down',stage:0};
  return null;
}

function createAutomation({readTemperature,readSettings,control,withLock,store,now=Date.now}){
  const status=async id=>await store.read(id)||{enabled:false,stage:null,reason:'수동 모드'};
  const probe=async id=>{
    const auto=await status(id);
    const result={auto};
    try{result.sample=await readTemperature(id);}
    catch(error){result.sensorError=error.status?error.message:'온도 센서 연결을 확인하지 못했습니다.';}
    try{result.settings=await readSettings(id);}
    catch(error){result.settingsError=error.status?error.message:'1그룹 설정온도를 읽지 못했습니다.';}
    return result;
  };
  const enable=async(id,stage)=>{
    if(!validStage(stage))throw fail('현장에서 확인한 현재 단계(0·1·2)를 선택하세요.');
    return withLock('auto_on',async()=>{
      const old=await status(id);
      if(old.enabled)throw fail('이미 자동 운전 중입니다. 단계를 변경하려면 자동 해제·정지를 먼저 누르세요.');
      control.ensureReady(await control.getState(id));
      const sample=await readTemperature(id);
      const settings=await readSettings(id);
      const auto={enabled:true,stage,pending:null,reason:'자동 운전 대기 · 5분마다 확인',...sample,settings,checkedAt:now(),lastActionAt:0};
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
    let sample,settings;
    try{
      sample=await readTemperature(id);
      settings=await readSettings(id);
      control.ensureReady(await control.getState(id));
    }catch(error){
      await store.write(id,{...auto,reason:error.status?error.message:'장치 연결 실패 · 자동 대기',checkedAt:now()});
      return;
    }
    auto={...auto,...sample,settings,checkedAt:now()};
    const next=nextAction(auto.stage,sample.temperature,settings);
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
module.exports={createAutomation,nextAction,MAX_SAMPLE_AGE,MIN_COMMAND_INTERVAL};
