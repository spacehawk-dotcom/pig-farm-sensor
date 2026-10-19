function serviceAccountConfig(value){
  let account;
  try{account=JSON.parse(value||'');}catch{}
  if(!account||typeof account!=='object'||typeof account.project_id!=='string'||typeof account.client_email!=='string'||typeof account.private_key!=='string')
    throw Object.assign(new Error('서버의 WINCH_FIREBASE_SERVICE_ACCOUNT 형식 오류입니다. Firebase 서비스 계정 JSON 전체가 필요합니다.'),{status:503});
  return {...account,private_key:account.private_key.replace(/\\n/g,'\n')};
}
function databaseError(error){
  if(error.status)return error;
  if(error.code==='MODULE_NOT_FOUND'||error.code==='ERR_MODULE_NOT_FOUND'){
    const missing=(String(error.message).match(/Cannot find (?:module|package) ['"]([^'"]+)['"]/)?.[1]||'unknown').replace(/[^a-zA-Z0-9_@./-]/g,'').slice(0,120);
    return Object.assign(new Error(`윈치 서버 모듈 누락 (${missing}). 서버 배포 설정을 확인하세요.`),{status:503});
  }
  const code=String(error.code||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40);
  return Object.assign(new Error(`윈치 서버 잠금 저장소 연결 실패 (${code}). Firebase 서비스 계정과 Firestore 권한을 확인하세요.`),{status:503});
}
module.exports={serviceAccountConfig,databaseError};
