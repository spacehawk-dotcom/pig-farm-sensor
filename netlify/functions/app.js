const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// ============================================================================
// 1. 파이어베이스 및 투야 초기 세팅
// ============================================================================
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    })
  });
}
const db = admin.firestore();

const tuya = new TuyaContext({
  /* 사장님의 진짜 번지수: 미국 서부 서버 주소 */
  baseUrl: 'https://openapi.tuyaus.com', 
  accessKey: (process.env.TUYA_ACCESS_KEY || '').trim(),
  secretKey: (process.env.TUYA_SECRET_KEY || '').trim(),
});
// ============================================================================
// 2. 사장님의 농장 12개 센서 목록 (돈사명과 투야 기기 ID)
// ============================================================================
const SENSOR_LIST = [
  // 이유사 (5개)
  { barnId: '이유_1배치', deviceId: 'ebff088984a475cb2btqrn' },
  { barnId: '이유_2배치', deviceId: 'eb0ca8871a16995b59kovf' },
  { barnId: '이유_3배치', deviceId: 'eb3f8ddd587bd4119escz2' },
  { barnId: '이유_4배치', deviceId: 'eb4e7b8af36acb727dp0nt' },
  { barnId: '이유_5배치', deviceId: 'eb5d316f6812ea62a6xmlh' },
  
  // 육성사 (6개)
  { barnId: '육성_1배치', deviceId: 'eb70d0012d9f941b0entme' },
  { barnId: '육성_2배치', deviceId: 'ebd2b0aa2af4f80d7aza5f' },
  { barnId: '육성_3배치', deviceId: 'eb1fe0222381581018qxa4' },
  { barnId: '육성_4배치', deviceId: 'ebb9d8d3af66c02dbbjklk' },
  { barnId: '육성_5배치', deviceId: 'eb1e0141e4547caf9f1wht' },
  { barnId: '육성_6배치', deviceId: 'eb2060a7a99e9c1111iwbs' },
  
  // 외부
  { barnId: '외부온도', deviceId: 'eb2d3364f04ac00e3cqrew' }
];

// ============================================================================
// 3. 데이터 수집 및 파이어베이스 저장 로직 (10분마다 실행)
// ============================================================================
const fetchAndSave = async () => {
  console.log("투야 센서 12개 데이터 수집 시작...");

  // 목록에 있는 12개 센서를 하나씩 돌면서 작업
  for (const sensor of SENSOR_LIST) {
    try {
      // 투야 서버에 센서 현재 상태(온/습도) 요청
      const response = await tuya.request({
        method: 'GET',
        path: `/v1.0/iot-03/devices/${sensor.deviceId}/status`,
      });

      // 기기 오프라인 등 통신 실패 시 에러만 띄우고 다음 센서로 넘어감
      if (!response.success) {
        console.error(`[${sensor.barnId}] 데이터 가져오기 실패:`, response.msg);
        continue; 
      }

      let temp = 0;
      let humidity = 0;

      // 투야에서 보내준 데이터 중 온도와 습도 값 뽑아내기
      response.result.forEach(item => {
        if (item.code === 'va_temperature' || item.code === 'temp_current') temp = item.value / 10;
        if (item.code === 'va_humidity' || item.code === 'humidity_value') humidity = item.value;
      });

      // 파이어베이스에 저장할 데이터 형식 구성
      const sensorLog = {
        barnId: sensor.barnId,  // 예: '이유_1배치'
        insideTemp: temp,
        insideHumidity: humidity,
        timestamp: admin.firestore.FieldValue.serverTimestamp() // 서버 시간 기록
      };

      // 파이어베이스 'sensor_logs' 컬렉션에 추가
      await db.collection('sensor_logs').add(sensorLog);
      console.log(`✅ [${sensor.barnId}] 온도: ${temp}°C, 습도: ${humidity}% 저장 완료!`);
      
    } catch (error) {
      console.error(`❌ [${sensor.barnId}] 처리 중 시스템 에러:`, error);
    }
  }
  
  console.log("모든 센서 데이터 수집 사이클 종료.");
  return { statusCode: 200 };
};

// 네플리파이에 10분('10m')마다 fetchAndSave 함수를 실행하라고 스케줄러 등록
exports.handler = schedule('@every 10m', fetchAndSave);