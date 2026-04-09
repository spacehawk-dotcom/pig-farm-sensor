const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');
const { TuyaContext } = require('@tuya/tuya-connector-nodejs');

// 파이어베이스 초기화 (중복 실행 방지 로직 포함)
if (!admin.apps.length) {
  const serviceAccount = require('../../firebase-adminsdk.json'); 
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// 투야 초기화
const tuya = new TuyaContext({
  baseUrl: 'https://openapi.tuyaus.com',
  accessKey: 'e89k9hxxpfjyw7ymwghj',
  secretKey: '수정요망    ',
});

const INSIDE_SENSOR_ID = '내부_온습도_센서_디바이스_ID';

// 실제 실행될 핵심 함수
const fetchAndSave = async () => {
  try {
    const response = await tuya.request({
      method: 'GET',
      path: `/v1.0/iot-03/devices/${INSIDE_SENSOR_ID}/status`,
    });

    if (!response.success) {
      console.error('투야 데이터 수집 실패:', response.msg);
      return { statusCode: 500 };
    }

    let temp = 0;
    let humidity = 0;

    response.result.forEach(item => {
      if (item.code === 'va_temperature' || item.code === 'temp_current') temp = item.value / 10;
      if (item.code === 'va_humidity' || item.code === 'humidity_value') humidity = item.value;
    });

    const sensorLog = {
      barnId: 'barn_01',
      insideTemp: temp,
      insideHumidity: humidity,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('sensor_logs').add(sensorLog);
    console.log("데이터 저장 완료!");
    
    return { statusCode: 200 };
  } catch (error) {
    console.error('에러 발생:', error);
    return { statusCode: 500 };
  }
};

// 네플리파이 스케줄러 설정 (크론 표현식: '*/10 * * * *' = 매 10분마다 실행)
exports.handler = schedule('*/10 * * * *', fetchAndSave);