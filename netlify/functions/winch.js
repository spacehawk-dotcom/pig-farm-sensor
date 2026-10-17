const crypto=require('node:crypto');
const {createHandler}=require('./lib/winch-control');
const env=process.env;
const delay=ms=>new Promise(r=>setTimeout(r,ms));

async function tuya(method,path,body,token=''){
  if(!env.TUYA_ACCESS_ID||!env.TUYA_ACCESS_SECRET)throw new Error('Tuya configuration missing');
  const json=body?JSON.stringify(body):'',t=String(Date.now());
  const signing=[method,crypto.createHash('sha256').update(json).digest('hex'),'',path].join('\n');
  const sign=crypto.createHmac('sha256',env.TUYA_ACCESS_SECRET).update(env.TUYA_ACCESS_ID+token+t+signing).digest('hex').toUpperCase();
  const response=await fetch('https://openapi.tuyaeu.com'+path,{method,headers:{client_id:env.TUYA_ACCESS_ID,access_token:token,t,sign,sign_method:'HMAC-SHA256','Content-Type':'application/json'},...(body?{body:json}:{}),signal:AbortSignal.timeout(4000)});
  const data=await response.json();
  if(!response.ok||data.success!==true)throw new Error('Tuya request failed');
  return data.result;
}

function database(){
  const admin=require('firebase-admin');
  if(!env.WINCH_FIREBASE_SERVICE_ACCOUNT)throw Object.assign(new Error('서버의 윈치 동시 제어 잠금 설정이 필요합니다.'),{status:503});
  const app=admin.apps.find(a=>a.name==='winch')||admin.initializeApp({credential:admin.credential.cert(JSON.parse(env.WINCH_FIREBASE_SERVICE_ACCOUNT))},'winch');
  return app.firestore();
}

// A shared transaction lock serializes commands across Netlify instances.
async function withLock(action,run){
  const db=database(),ref=db.doc('winch_server_locks/grower_2'),owner=crypto.randomUUID();
  let acquired=false;
  for(let i=0;i<(action==='stop'?13:1);i++){
    acquired=await db.runTransaction(async tx=>{
      const old=(await tx.get(ref)).data();
      if(old?.expiresAt>Date.now())return false;
      tx.set(ref,{owner,expiresAt:Date.now()+90000});return true;
    });
    if(acquired)break;
    if(action==='stop')await delay(500);
  }
  if(!acquired)throw Object.assign(new Error('다른 제어 요청 처리 중입니다. 잠시 후 다시 시도하세요.'),{status:409});
  try{return await run();}
  finally{
    await db.runTransaction(async tx=>{const old=(await tx.get(ref)).data();if(old?.owner===owner)tx.delete(ref);});
  }
}

exports.handler=async event=>{
  let token;
  return createHandler({env,withLock,request:async(method,path,body)=>{
    if(!token)token=(await tuya('GET','/v1.0/token?grant_type=1')).access_token;
    return tuya(method,path,body,token);
  }})(event);
};
