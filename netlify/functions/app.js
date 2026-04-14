// 1. 필요한 도구들을 가장 먼저 불러옵니다 (열쇠 준비)
const axios = require('axios');
const crypto = require('crypto');
const admin = require('firebase-admin');

// 2. 파이어베이스 주소를 알려주고 초기화합니다 (창고 위치 확인)
if (!admin.apps.length) {
    admin.initializeApp({
        databaseURL: "https://sungamfarm-default-rtdb.firebaseio.com"
    });
}

// 3. 반드시 초기화가 끝난 '이후에' 창고 문을 열어야 합니다! (순서가 매우 중요)
const db = admin.database(); 

// ---------------------------------------------------------
// (주의) 여기에 사장님이 쓰시던 투야 getHeaders() 함수 코드를 그대로 두세요!
// function getHeaders(url) { ... } 
// ---------------------------------------------------------

exports.handler = async (event, context) => {
    // 투야 API 키 설정 (기존 것 그대로 사용)
    const ACCESS_ID = 'vfdhuhsr8f4n53m7mcep';
    const ACCESS_SECRET = '32778d3a7e8841c9abe044bf0559d797';
    const BASE_URL = 'https://openapi.tuyaeu.com';

    const devices = [
        { id: 'bf3a297e3c2c203b0dlq2t', name: '이유_1배치' },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치' },
        { id: 'bf93b8a56123596b3cqm5q', name: '이유_3배치' },
        { id: 'bfc20cd2af7ace2e1ashgo', name: '이유_4배치' },
        { id: 'bf9e07f0335ffd36cbakuf', name: '이유_5배치' },
        { id: 'bf4eaae9ac91ea9819nnva', name: '육성_1배치' }
    ];

    try {
        const results = {};

        // 모든 기기에서 온도/습도를 순서대로 가져옵니다.
        for (const device of devices) {
            try {
                // 투야 API 호출
                const response = await axios.get(
                    `${BASE_URL}/v1.0/devices/${device.id}/status`,
                    { headers: getHeaders(`${BASE_URL}/v1.0/devices/${device.id}/status`) } // getHeaders 함수가 위에 있어야 합니다.
                );

                const status = response.data.result;
                
                // 투야 데이터에서 온도와 습도 값을 찾아냅니다.
                const temp = status.find(s => s.code.includes('temp'))?.value / 10 || 0;
                const humi = status.find(s => s.code.includes('humidity'))?.value || 0;

                // env.html이 기다리는 구역 이름을 키값으로 설정!
                results[device.name] = {
                    temp: temp.toFixed(1), // "25.4" 형식
                    humi: humi,            // "60" 형식
                    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                };

            } catch (err) {
                console.error(`${device.name} 가져오기 실패:`, err.message);
                results[device.name] = {
                    temp: "--",
                    humi: "--",
                    timestamp: "연결실패"
                };
            }
        }

        // 4. 사장님의 실시간 창고(sensor_logs)에 통째로 덮어쓰기!
        await db.ref('sensor_logs').set(results);
        
        return { 
            statusCode: 200, 
            body: JSON.stringify({ message: "성암농장 데이터 배달 완료!", data: results }) 
        };

    } catch (error) {
        console.error("전체 공정 에러:", error);
        return { statusCode: 500, body: error.message };
    }
};