const crypto=require('node:crypto');
const {getApps,initializeApp,cert}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {createHandler,WINCHES}=require('./winch-control');
const {createAutomation}=require('./winch-automation.cjs');
const {createHaTemperatureReader}=require('./winch-ha-temperature.cjs');
const {createSetpointReader}=require('./winch-setpoint.cjs');
const {createOffsetStore}=require('./winch-offsets.cjs');
const {serviceAccountConfig,databaseError}=require('./winch-errors.cjs');
const env=process.env;
const delay=ms=>new Promise(r=>setTimeout(r,ms));

const {createLocalControl,workerApi,authenticated}=require('./winch-local.cjs');
const wakeRoot='https://sungamfarm-default-rtdb.firebaseio.com/winch_local_wakeup';
async function notify(id,payload){
  const r=await fetch(wakeRoot+'/'+id+'.json',{method:'PUT',body:JSON.stringify(payload),headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(3500)});
  if(!r.ok)throw new Error('HA notification unavailable');
}

function database(){
  if(!env.WINCH_FIREBASE_SERVICE_ACCOUNT)throw Object.assign(new Error('서버의 윈치 동시 제어 잠금 설정이 필요합니다.'),{status:503});
  try{
    // Static imports ensure the deploy packager includes both Firebase modules.
    const app=getApps().find(a=>a.name==='winch')||initializeApp({credential:cert(serviceAccountConfig(env.WINCH_FIREBASE_SERVICE_ACCOUNT))},'winch');
    return getFirestore(app);
  }catch(error){throw databaseError(error);}
}

// A shared transaction lock serializes commands across Netlify instances.
async function acquireLock(action,run,batchId){
  const db=database(),ref=db.doc(`winch_server_locks/grower_${batchId}`),owner=crypto.randomUUID();
  let acquired=false;
  for(let i=0;i<(action==='stop'?13:1);i++){
    acquired=await db.runTransaction(async tx=>{
      const old=(await tx.get(ref)).data();
      if(old?.expiresAt>Date.now())return false;
      tx.set(ref,{owner,expiresAt:Date.now()+90000});return true;
    }).catch(error=>{throw databaseError(error);});
    if(acquired)break;
    if(action==='stop')await delay(500);
  }
  if(!acquired)throw Object.assign(new Error('다른 제어 요청 처리 중입니다. 잠시 후 다시 시도하세요.'),{status:409});
  try{return await run();}
  finally{
    await db.runTransaction(async tx=>{const old=(await tx.get(ref)).data();if(old?.owner===owner)tx.delete(ref);}).catch(error=>{throw databaseError(error);});
  }
}
async function withLock(action,run,batchId){
  return acquireLock(action,run,batchId);
}

function runtime(){
  const control=createLocalControl({env,database,notify});
  // Reuse the already server-only collection; browser Firestore rules deny all access.
  const store={
    read:async id=>{try{return (await database().doc(`winch_server_locks/auto_grower_${id}`).get()).data();}catch(error){throw databaseError(error);}},
    write:async(id,state)=>{try{await database().doc(`winch_server_locks/auto_grower_${id}`).set(state);}catch(error){throw databaseError(error);}}
  };
  const readTemperature=createHaTemperatureReader({registry:WINCHES});
  const offsetStore=createOffsetStore({database});
  const readSettings=createSetpointReader({database,registry:WINCHES,readOffsets:offsetStore.read});
  const automation=createAutomation({readTemperature,readSettings,control,withLock,store});
  return {control,automation,offsetStore};
}
exports.handler=async event=>{
  const {control,automation,offsetStore}=runtime();
  return createHandler({env,withLock,control,automation,offsetStore})(event);
};
exports.scheduled=async()=>{
  const {automation}=runtime();
  // Scheduled functions run only on published deploys. Per-device commissioning still applies.
  const results=await Promise.allSettled(Object.entries(WINCHES).map(async([id,config])=>{
    if(env[config.enabledEnv]==='true')await automation.tick(id);
  }));
  if(results.some(result=>result.status==='rejected'))throw new Error('자동 윈치 확인 실패: 저장소 또는 동시 제어 상태를 확인하세요.');
};

exports.worker=async(token,body)=>{
  if(!authenticated(token))throw Object.assign(new Error('Unauthorized'),{status:401});
  return workerApi(database(),body);
};
