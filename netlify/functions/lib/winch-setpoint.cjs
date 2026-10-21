const fail=message=>Object.assign(new Error(message),{status:409});
function thresholdsFor(targetTemperature){
  // Match the temperature app's saved 1-group input validation.
  if(!Number.isInteger(targetTemperature)||targetTemperature<5||targetTemperature>40)
    throw fail('1그룹 설정온도가 없거나 올바르지 않습니다. 온도앱에서 해당 배치 설정을 저장하세요.');
  return {targetTemperature,up1:(targetTemperature*10+3)/10,up2:targetTemperature+3,
    down1:(targetTemperature*10-3)/10,down0:targetTemperature-3};
}
function createSetpointReader({database,registry}){
  return async id=>{
    if(!/^[1-7]$/.test(String(id))||!Object.hasOwn(registry,String(id)))throw fail('등록되지 않은 배치입니다.');
    let snapshot;
    try{snapshot=await database().doc(`farms/sungamfarm/grower/batch_${id}`).get();}
    catch{throw fail('1그룹 설정온도를 읽지 못했습니다. 자동 운전을 대기합니다.');}
    return thresholdsFor(snapshot.data()?.ventilationOverrides?.f500_1?.t);
  };
}
module.exports={thresholdsFor,createSetpointReader};
