const axios = require('axios');
const crypto = require('crypto');

exports.handler = async (event, context) => {
    const ACCESS_ID = process.env.TUYA_ACCESS_ID;
    const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
    const BASE_URL = 'https://openapi.tuyaeu.com'; // 유럽 서버

    // 사장님의 센서 12개 리스트 (ID 확인 필수!)
    const devices = [
        { id: 'bf3a297e3c2c203b0dlq2t', name: '이유_1배치' },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치' },
        // 나머지 센서 ID들도 여기에 {id: '...', name: '...'} 형식으로 추가하세요.
    ];

    try {
        // 1. 토큰 가져오기
        const t = Date.now();
        const str = ACCESS_ID + t;
        const sign = crypto.createHmac('sha256', ACCESS_SECRET).update(str).digest('hex').toUpperCase();
        
        const tokenRes = await axios.get(`${BASE_URL}/v1.0/token?grant_type=1`, {
            headers: { t, sign, client_id: ACCESS_ID }
        });
        const token = tokenRes.data.result.access_token;

        // 2. 모든 기기 데이터 수집
        const results = await Promise.all(devices.map(async (dev) => {
            const t2 = Date.now();
            const str2 = ACCESS_ID + token + t2;
            const sign2 = crypto.createHmac('sha256', ACCESS_SECRET).update(str2).digest('hex').toUpperCase();

            const res = await axios.get(`${BASE_URL}/v1.0/devices/${dev.id}/status`, {
                headers: { t: t2, sign: sign2, client_id: ACCESS_ID, access_token: token }
            });

            const status = res.data.result || [];
            
            // 온도/습도 코드 자동 감지 로직
            const tempObj = status.find(s => ['va_temperature', 'Temperature', 'temp_current'].includes(s.code));
            const humiObj = status.find(s => ['va_humidity', 'Humidity', 'humidity_value'].includes(s.code));

            let temp = tempObj ? parseFloat(tempObj.value) : 0;
            let humi = humiObj ? parseFloat(humiObj.value) : 0;

            // 소수점 처리 (255 -> 25.5)
            if (temp > 100) temp = temp / 10;
            if (humi > 100) humi = humi / 10;

            return { name: dev.name, temp: temp.toFixed(1), humi: humi.toFixed(1) };
        }));

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(results)
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};