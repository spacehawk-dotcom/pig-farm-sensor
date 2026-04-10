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
  /* 사장님의 진짜 번지수: 유럽 중부 서버 주소 */
  baseUrl: 'https://openapi.tuyaeu.com', 
  accessKey: (process.env.TUYA_ACCESS_KEY || '').trim(),
  secretKey: (process.env.TUYA_SECRET_KEY || '').trim(),
});

// ============================================================================
// 2. 농장 12개 센서 목록 (돈사명과 투야 기기 ID)
// ============================================================================
const SENSOR_LIST = [
  // 이유사 (5개)
  { barnId: '이유_1배치', deviceId: 'bf3a297e3c2c203b0dlq2t' },
  { barnId: '이유_2배치', deviceId: 'bfd2815413e3900144gwjv' },
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

// ... (기존 루프 안에서)
      let temp = 0;
      let humidity = 0;

      // 로그 확인용: 빈 데이터가 아닌데도 못 찾는 경우를 대비
      const rawData = response.result;

      rawData.forEach(item => {
        const code = item.code.toLowerCase();
        const val = Number(item.value);

        // 1. 온도 찾기: 코드명에 temp, t, va_ 가 들어가는 모든 숫자 데이터
        if (code.includes('temp') || code.includes('va_') || code === 't') {
          if (!isNaN(val) && val !== 0) {
            // 100 이상이면 10으로 나누고(255 -> 25.5), 아니면 그대로 사용
            temp = val > 100 ? val / 10 : val;
          }
        }
        
        // 2. 습도 찾기: 코드명에 hum, h, va_ 가 들어가는 모든 숫자 데이터
        if (code.includes('hum') || code.includes('va_') || code === 'h') {
          if (!isNaN(val) && val !== 0 && !code.includes('temp')) {
            humidity = val > 100 ? val / 10 : val;
          }
        }

        // 3. ★ 최후의 수단: 코드가 위 조건에 안 걸려도 값이 들어있다면 매칭
        // 투야 일부 모델은 'va_temperature' 대신 'va_temp' 등을 씁니다.
        if (temp === 0 && (code.startsWith('va_') || code.length === 1)) {
           if (!isNaN(val) && val !== 0) temp = val > 100 ? val / 10 : val;
        }
      });

      // 데이터가 둘 다 0이면 (여전히 못 찾았다면) 원본 구조를 로그에 상세히 출력
      if (temp === 0 && humidity === 0) {
        console.warn(`🚨 [${sensor.barnId}] 분석 실패! 원본 데이터: ${JSON.stringify(rawData)}`);
        continue; 
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