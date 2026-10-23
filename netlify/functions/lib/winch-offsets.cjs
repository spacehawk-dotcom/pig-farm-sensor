const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const {databaseError}=require('./winch-errors.cjs');
// User-approved initial values. Persist once; later manual edits always win.
const INITIAL_OFFSETS={up:[0.3,1.5,3],down:[-0.3,-1.5,-3]};

function validateOffsets(value){
  if(!value||typeof value!=='object')throw fail('올림·내림 편차를 각각 3개 입력하세요.');
  const result={};
  for(const direction of ['up','down']){
    const list=value[direction];
    if(!Array.isArray(list)||list.length!==3)throw fail('올림·내림 편차를 각각 3개 입력하세요.');
    if(list.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>20||
      Math.abs(n*10-Math.round(n*10))>1e-8||(direction==='up'?n<=0:n>=0)))
      throw fail('올림은 +0.1~+20℃, 내림은 −0.1~−20℃ 범위에서 소수 첫째 자리까지 입력하세요.');
    if(list.some((n,i)=>i>0&&(direction==='up'?n<=list[i-1]:n>=list[i-1])))
      throw fail('1차→2차→3차 순서로 기준온도에서 멀어지도록 편차를 입력하세요.');
    result[direction]=[...list];
  }
  return result;
}

function createOffsetStore({database,now=Date.now}){
  const reference=()=>database().doc('winch_server_locks/temperature_offsets');
  const read=async()=>{
    let data;
    try{data=(await reference().get()).data();}
    catch(error){throw databaseError(error);}
    if(!data)return {configured:false,revision:0,offsets:validateOffsets(INITIAL_OFFSETS)};
    return {configured:true,revision:data.revision,offsets:validateOffsets(data.offsets)};
  };
  const save=async(value,revision)=>{
    const offsets=validateOffsets(value);
    if(!Number.isSafeInteger(revision)||revision<0)throw fail('저장된 편차를 먼저 불러오세요.');
    const db=database(),ref=reference();
    try{return await db.runTransaction(async tx=>{
      const old=(await tx.get(ref)).data();
      if((old?.revision||0)!==revision)throw fail('다른 화면에서 편차가 변경됐습니다. 다시 불러온 후 저장하세요.');
      const next={offsets,revision:revision+1,updatedAt:now()};
      tx.set(ref,next);
      return {configured:true,offsets,revision:next.revision};
    });}catch(error){if(error.status)throw error;throw databaseError(error);}
  };
  return {read,save};
}
module.exports={validateOffsets,createOffsetStore};
