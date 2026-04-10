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
// 2. 농장 12개 센서 목록 (돈사명과 투야 기기 ID)
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

  for (const sensor of SENSOR_LIST) {
    try {
      const response = await tuya.request({
        method: 'GET',
        path: `/v1.0/iot-03/devices/${sensor.deviceId}/status`,
      });

      if (!response.success) {
        console.error(`[${sensor.barnId}] 데이터 가져오기 실패:`, response.msg);
        continue; 
      }

      let temp = 0;
      let humidity = 0;
      
      // ★ 원인 분석을 위해 투야에서 온 원본 데이터를 문자열로 저장해 둡니다.
      const rawDataString = JSON.stringify(response.result);

      response.result.forEach(item => {
        // 코드 이름을 소문자로 변환
        const code = item.code ? item.code.toLowerCase() : ''; 
        // 값을 숫자로 강제 변환 시도 (문자 'c' 등이 오면 NaN이 됨)
        const numValue = Number(item.value);

        // 1. 온도 찾기
        if (code.includes('temp') || code === 'va_temperature' || code === 't') {
          if (!isNaN(numValue)) {
            temp = numValue > 100 ? numValue / 10 : numValue;
          }
        }
        
        // 2. 습도 찾기
        if (code.includes('hum') || code === 'va_humidity' || code === 'h') {
          if (!isNaN(numValue)) {
            humidity = numValue > 100 ? numValue / 10 : numValue;
          }
        }
      });

      // ★ 핵심: 값이 여전히 0이거나 비정상이라면, 원본 데이터를 로그에 쫙 뿌려줍니다.
      if (temp === 0 || humidity === 0) {
        console.warn(`⚠️ [${sensor.barnId}] 데이터 이상 감지! 기기 원본 데이터: ${rawDataString}`);
      }

      const sensorLog = {
        barnId: sensor.barnId, 
        insideTemp: temp,
        insideHumidity: humidity,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('sensor_logs').add(sensorLog);
      console.log(`✅ [${sensor.barnId}] 온도: ${temp}°C, 습도: ${humidity}% 저장 완료!`);
      
    } catch (error) {
      console.error(`❌ [${sensor.barnId}] 처리 중 시스템 에러:`, error);
    }
  }
  
  console.log("모든 센서 데이터 수집 사이클 종료.");
  return { statusCode: 200 };
};

exports.handler = schedule('@every 10m', fetchAndSave);