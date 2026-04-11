const axios = require('axios');
const crypto = require('crypto');

exports.handler = async (event, context) => {
    // 공백 자동 제거 기능 포함
    const ACCESS_ID = (process.env.TUYA_ACCESS_ID || '').trim();
    const ACCESS_SECRET = (process.env.TUYA_ACCESS_SECRET || '').trim();
    const BASE_URL = 'https://openapi.tuyaeu.com';

    // 🚨 사장님! 아래 작은 따옴표('') 안에만 복사한 ID를 쏙 넣어주세요.
    // 따옴표나 끝에 있는 쉼표(,)가 지워지면 다시 502 에러가 납니다!
    const devices = [
        { id: '여기에_이유1_ID_입력', name: '이유_1배치' },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치' }, // 이건 잘 작동하는 ID
        { id: '여기에_이유3_ID_입력', name: '이유_3배치' },
        { id: '여기에_이유4_ID_입력', name: '이유_4배치' },
        { id: '여기에_이유5_ID_입력', name: '이유_5배치' },
        { id: '여기에_육성1_ID_입력', name: '육성_1배치' },
        { id: '여기에_육성2_ID_입력', name: '육성_2배치' },
        { id: '여기에_육성3_ID_입력', name: '육성_3배치' },
        { id: '여기에_육성4_ID_입력', name: '육성_4배치' },
        { id: '여기에_육성5_ID_입력', name: '육성_5배치' },
        { id: '여기에_육성6_ID_입력', name: '육성_6배치' },
        { id: '여기에_외부온도_ID_입력', name: '외부온도' }
    ];

    try {
        if (!ACCESS_ID || !ACCESS_SECRET) {
            throw new Error("넷리파이에 아이디/비밀번호가 없습니다.");
        }

        const t = Date.now().toString();
        const str = ACCESS_ID + t;
        const sign = crypto.createHmac('sha256', ACCESS_SECRET).update(str).digest('hex').toUpperCase();
        
        const tokenRes = await axios.get(`${BASE_URL}/v1.0/token?grant_type=1`, {
            headers: { 
                client_id: ACCESS_ID, 
                sign: sign, 
                t: t,
                sign_method: 'HMAC-SHA256'
            }
        });
        
        if (!tokenRes.data.success) throw new Error("토큰 실패: " + tokenRes.data.msg);
        const token = tokenRes.data.result.access_token;

        const results = await Promise.all(devices.map(async (dev) => {
            try {
                // ID가 한글이거나 이상하면 투야 서버에 물어보지 않고 바로 0도 처리 (에러 방지)
                if (dev.id.includes('여기에_')) return { name: dev.name, temp: "0.0", humi: "0" };

                const t2 = Date.now().toString();
                const str2 = ACCESS_ID + token + t2;
                const sign2 = crypto.createHmac('sha256', ACCESS_SECRET).update(str2).digest('hex').toUpperCase();
                
                const res = await axios.get(`${BASE_URL}/v1.0/devices/${dev.id}/status`, {
                    headers: { 
                        client_id: ACCESS_ID, 
                        access_token: token, 
                        sign: sign2, 
                        t: t2,
                        sign_method: 'HMAC-SHA256'
                    }
                });

                const status = res.data.result || [];
                const tempObj = status.find(s => ['va_temperature', 'Temperature', 'temp_current'].includes(s.code));
                const humiObj = status.find(s => ['va_humidity', 'Humidity', 'humidity_value'].includes(s.code));

                let temp = tempObj ? parseFloat(tempObj.value) : 0;
                let humi = humiObj ? parseFloat(humiObj.value) : 0;

                if (temp > 100) temp = temp / 10;
                if (humi > 100) humi = humi / 10;

                return { name: dev.name, temp: temp.toFixed(1), humi: humi.toFixed(1) };
            } catch (e) {
                return { name: dev.name, temp: "0.0", humi: "0" };
            }
        }));

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(results)
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};