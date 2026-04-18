const axios = require('axios');
const crypto = require('crypto');

// 투야 API 헤더 생성 함수
function getHeaders(url) {
    const ACCESS_ID = 'vfdhuhsr8f4n53m7mcep';
    const ACCESS_SECRET = '32778d3a7e8841c9abe044bf0559d797';
    const t = Date.now().toString();
    const nonce = '';
    const method = 'GET';
    const contentHash = crypto.createHash('sha256').update('').digest('hex');
    const stringToSign = [method, contentHash, '', url].join('\n');
    const signStr = ACCESS_ID + t + nonce + stringToSign;
    const sign = crypto.createHmac('sha256', ACCESS_SECRET).update(signStr).digest('hex').toUpperCase();

    return {
        'client_id': ACCESS_ID,
        'sign': sign,
        't': t,
        'sign_method': 'HMAC-SHA256',
        'nonce': nonce
    };
}

exports.handler = async (event, context) => {
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
        for (const device of devices) {
            try {
                const response = await axios.get(
                    `${BASE_URL}/v1.0/devices/${device.id}/status`,
                    { headers: getHeaders(`/v1.0/devices/${device.id}/status`) }
                );
                const status = response.data.result;
                const temp = status.find(s => s.code.includes('temp'))?.value / 10 || 0;
                const humi = status.find(s => s.code.includes('humidity'))?.value || 0;

                results[device.name] = {
                    temp: temp.toFixed(1),
                    humi: humi,
                    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                };
            } catch (err) {
                console.error(`${device.name} 실패:`, err.message);
                results[device.name] = { temp: "--", humi: "--", timestamp: "연결실패" };
            }
        }

        // 🌟 무거운 도구 대신 파이어베이스 주소로 직접 쏴버리는 가벼운 방식 적용!
        const firebaseURL = "https://sungamfarm-default-rtdb.firebaseio.com/sensor_logs.json";
        await axios.put(firebaseURL, results);
        
        return { 
            statusCode: 200, 
            body: JSON.stringify({ message: "성암농장 데이터 배달 완료!", data: results }) 
        };

    } catch (error) {
        console.error("전체 에러:", error);
        return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
    }
};