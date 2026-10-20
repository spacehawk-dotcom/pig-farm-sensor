const MAX_SAMPLE_AGE=15*60*1000;
const fail=message=>Object.assign(new Error(message),{status:409});
const DATABASE_URL='https://sungamfarm-default-rtdb.firebaseio.com';

// Existing HA exporter sends the sensor's last received time in Korean local time.
// Never replace it with the server fetch time. Validate calendar fields explicitly:
// Date.parse of this locale string depends on the server timezone and runtime.
function parseKoreanTimestamp(value){
  if(typeof value!=='string')return NaN;
  const match=value.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})$/);
  if(!match)return NaN;
  const [,year,month,day,period,hour,minute,second]=match;
  const y=Number(year),m=Number(month),d=Number(day),h=Number(hour),min=Number(minute),s=Number(second);
  if(y<2020||m<1||m>12||d<1||d>31||h<1||h>12||min>59||s>59)return NaN;
  const hour24=h%12+(period==='오후'?12:0);
  const local=Date.UTC(y,m-1,d,hour24,min,s),check=new Date(local);
  if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)return NaN;
  return local-9*60*60*1000;
}

function parseHaTemperature(record,now=Date.now()){
  if(!record||typeof record!=='object'||record.online===false||record.available===false)
    throw fail('HA 온도 데이터 없음 또는 센서 오프라인 · 자동 대기');
  const raw=record.temp;
  const temperature=typeof raw==='number'?raw:
    typeof raw==='string'&&/^-?\d+(\.\d+)?$/.test(raw)?Number(raw):NaN;
  if(!Number.isFinite(temperature)||temperature< -40||temperature>80)
    throw fail('HA 온도 측정값 오류 · 자동 대기');
  // temp is Celsius in the existing sensor_logs contract, already scaled by HA.
  if(record.unit!==undefined&&!['℃','°C','C','c'].includes(record.unit))
    throw fail('HA 온도 단위 확인 필요 · 자동 대기');
  const measuredAt=parseKoreanTimestamp(record.timestamp);
  if(!Number.isFinite(measuredAt)||now-measuredAt>=MAX_SAMPLE_AGE||measuredAt>now+30000)
    throw fail('HA 센서 갱신이 15분 이상 지연되었거나 수신 시각이 불확실합니다.');
  return {temperature,measuredAt,source:'ha'};
}

function createHaTemperatureReader({registry,fetchImpl=fetch,now=Date.now}){
  return async id=>{
    const key=registry[id]?.haSensorKey;
    if(!key)throw fail('이 배치의 HA 온도 데이터가 등록되지 않았습니다.');
    let record;
    try{
      const response=await fetchImpl(`${DATABASE_URL}/sensor_logs/${encodeURIComponent(key)}.json`,{
        method:'GET',cache:'no-store',signal:AbortSignal.timeout(4000)
      });
      if(!response.ok)throw new Error('read failed');
      record=await response.json();
    }catch{
      throw fail('HA 온도 저장소를 읽지 못했습니다. 전송 상태를 확인하세요.');
    }
    return parseHaTemperature(record,now());
  };
}

module.exports={createHaTemperatureReader,parseHaTemperature,parseKoreanTimestamp,MAX_SAMPLE_AGE};
