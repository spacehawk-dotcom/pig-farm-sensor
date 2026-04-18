const axios = require('axios');
const crypto = require('crypto');

const ACCESS_ID = 'vfdhuhsr8f4n53m7mcep';
const ACCESS_SECRET = '32778d3a7e8841c9abe044bf0559d797';
const BASE_URL = 'https://openapi.tuyaeu.com'; 

async function getTuyaToken() {
    const t = Date.now().toString();
    const method = 'GET';
    const path = '/v1.0/token?grant_type=1';
    const contentHash = crypto.createHash('sha256').update('').digest('hex');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const signStr = ACCESS_ID + t + stringToSign;
    const sign = crypto.createHmac('sha256', ACCESS_SECRET).update(signStr).digest('hex').toUpperCase();

    const res = await axios.get(BASE_URL + path, {
        headers: { 'client_id': ACCESS_ID, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256' }
    });
    if (!res.data.success) throw new Error("토큰 발급 실패: " + res.data.msg);
    return res.data.result.access_token;
}

// 🌟 다시 온도를 직접 캐묻는 방식으로 변경! (대신 거절 사유를 낱낱이 기록함)
async function getDeviceStatus(deviceId, token) {
    const t = Date.now().toString();
    const method = 'GET';
    const path = `/v1.0/devices/${deviceId}/status`;
    const contentHash = crypto.createHash('sha256').update('').digest('hex');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const signStr = ACCESS_ID + token + t + stringToSign;
    const sign = crypto.createHmac('sha256', ACCESS_SECRET).update(signStr).digest('hex').toUpperCase();

    const res = await axios.get(BASE_URL + path, {
        headers: { 'client_id': ACCESS_ID, 'access_token': token, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256' }
    });
    
    // 투야가 거절하면, 거절한 진짜 이유(msg)를 에러로 뱉어냅니다.
    if (!res.data.success) throw new Error(res.data.msg);
    return res.data.result;
}

exports.handler = async (event, context) => {
    const devices = [
        { id: 'bf3a297e3c2c203b0dlq2t', name: '이유_1배치' },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치' },
        { id: 'bf93b8a56123596b3cqm5q', name: '이유_3배치' },
        { id: 'bfc20cd2af7ace2e1ashgo', name: '이유_4배치' },
        { id: 'bf9e07f0335ffd36cbakuf', name: '이유_5배치' },
        { id: 'bf4eaae9ac91ea9819nnva', name: '육성_1배치' }
    ];

    try {
        const token = await getTuyaToken(); 
        const results = {};

        for (const device of devices) {
            try {
                const status = await getDeviceStatus(device.id, token);
                const temp = status.find(s => s.code.includes('temp'))?.value / 10 || 0;
                const humi = status.find(s => s.code.includes('humidity') || s.code.includes('humi'))?.value || 0;

                results[device.name] = {
                    temp: temp.toFixed(1),
                    humi: humi,
                    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                };
            } catch (err) {
                console.error(`${device.name} 실패:`, err.message);
                // 🌟 핵심! 연결실패 대신 투야의 '진짜 거절 사유'를 시간 자리에 띄워줍니다!
                results[device.name] = { temp: "--", humi: "--", timestamp: err.message.substring(0, 25) };
            }
        }

        const firebaseURL = "https://sungamfarm-default-rtdb.firebaseio.com/sensor_logs.json";
        await axios.put(firebaseURL, results);
        
        return { statusCode: 200, body: JSON.stringify({ message: "진단용 데이터 배달 완료", data: results }) };

    } catch (error) {
        console.error("전체 에러:", error);
        return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
    }
};