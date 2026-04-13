const axios = require('axios');
const crypto = require('crypto');
const admin = require('firebase-admin');

// 1. 파이어베이스 초기화 (가장 안전한 방식)
if (!admin.apps.length) {
    admin.initializeApp({
        databaseURL: "https://sungamfarm-default-rtdb.firebaseio.com" 
    });
}

const db = admin.database();

exports.handler = async (event, context) => {
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
        const t = Date.now().toString();
        const str = ACCESS_ID + t;
        const sign = crypto.createHmac('sha256', ACCESS_SECRET).update(str).digest('hex').toUpperCase();
        
        const tokenRes = await axios.get(`${BASE_URL}/v1.0/token?grant_type=1`, {
            headers: { client_id: ACCESS_ID, sign: sign, t: t, sign_method: 'HMAC-SHA256' }
        });
        
        if (!tokenRes.data.success) throw new Error("토큰 실패: " + tokenRes.data.msg);
        const token = tokenRes.data.result.access_token;

        // 데이터를 앱 화면 구조에 맞게 재구성합니다.
        const updateData = {};
        const currentTime = new Date().toLocaleString("ko-KR", {timeZone: "Asia/Seoul"});

        for (const dev of devices) {
            try {
                const t2 = Date.now().toString();
                const str2 = ACCESS_ID + token + t2;
                const sign2 = crypto.createHmac('sha256', ACCESS_SECRET).update(str2).digest('hex').toUpperCase();
                
                const res = await axios.get(`${BASE_URL}/v1.0/devices/${dev.id}/status`, {
                    headers: { client_id: ACCESS_ID, access_token: token, sign: sign2, t: t2, sign_method: 'HMAC-SHA256' }
                });

                const status = res.data.result || [];
                const tempObj = status.find(s => ['va_temperature', 'temp_current', 'Temperature'].includes(s.code));
                const humiObj = status.find(s => ['va_humidity', 'humidity_value', 'Humidity'].includes(s.code));

                let temp = tempObj ? parseFloat(tempObj.value) : 0;
                let humi = humiObj ? parseFloat(humiObj.value) : 0;

                if (temp > 100) temp = temp / 10;
                if (humi > 100) humi = humi / 10;

                // 핵심: env.html이 읽을 수 있게 "이름"을 키값으로 저장합니다.
                updateData[dev.name] = {
                    temp: temp.toFixed(1),
                    humi: humi.toFixed(0),
                    timestamp: currentTime
                };
            } catch (e) {
                updateData[dev.name] = { temp: "0.0", humi: "0", timestamp: "연결실패" };
            }
        }

        // 2. 파이어베이스 실시간 창고에 덮어쓰기!
        await db.ref('sensor_logs').set(updateData);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ success: true, time: currentTime })
        };

    } catch (error) {
        console.error("Critical Error:", error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};