import {getApps,initializeApp,cert} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import store from './lib/feeder-store.cjs';
import errors from './lib/winch-errors.cjs';
import local from './lib/winch-local.cjs';
function database(){
  const account=process.env.FEEDER_FIREBASE_SERVICE_ACCOUNT||process.env.WINCH_FIREBASE_SERVICE_ACCOUNT;
  if(!account)throw Object.assign(new Error('Storage not configured'),{status:503});
  const app=getApps().find(a=>a.name==='feeder-monitor')||initializeApp({credential:cert(errors.serviceAccountConfig(account))},'feeder-monitor');
  return getFirestore(app);
}
export default async function(request){
  const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  try{
    if(request.method==='GET')return json(await store.readReport(database()));
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(!local.authenticated(request.headers.get('x-ha-bridge')))return json({error:'Unauthorized'},401);
    const text=await request.text();if(text.length>65536)return json({error:'Report too large'},413);
    return json(await store.acceptReport(database(),JSON.parse(text)));
  }catch(error){const status=error instanceof SyntaxError?400:error.status||503;return json({error:status===400?'Invalid report':'급이기 전달 서버 연결을 확인하세요.'},status);}
}
