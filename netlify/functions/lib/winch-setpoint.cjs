const fail=message=>Object.assign(new Error(message),{status:409});
const {validateOffsets}=require('./winch-offsets.cjs');
function thresholdsFor(targetTemperature,offsets){
  // Match the temperature app's saved 1-group input validation.
  if(!Number.isInteger(targetTemperature)||targetTemperature<5||targetTemperature>40)
    throw fail('1그룹 설정온도가 없거나 올바르지 않습니다. 온도앱에서 해당 배치 설정을 저장하세요.');
  const checked=validateOffsets(offsets);
  return {targetTemperature,up:checked.up.map(n=>Math.round((targetTemperature+n)*10)/10),
    down:checked.down.map(n=>Math.round((targetTemperature+n)*10)/10),offsets:checked};
}
function createSetpointReader({database,registry,readOffsets}){
  return async id=>{
    if(!/^[1-7]$/.test(String(id))||!Object.hasOwn(registry,String(id)))throw fail('등록되지 않은 배치입니다.');
    let snapshot;
    try{snapshot=await database().doc(`farms/sungamfarm/grower/batch_${id}`).get();}
    catch{throw fail('1그룹 설정온도를 읽지 못했습니다. 자동 운전을 대기합니다.');}
    const config=await readOffsets();
    if(!config.configured)throw fail('상단에서 공통 온도 편차 6개를 저장한 후 자동 운전을 시작하세요.');
    return {...thresholdsFor(snapshot.data()?.ventilationOverrides?.f500_1?.t,config.offsets),revision:config.revision};
  };
}
module.exports={thresholdsFor,createSetpointReader};
