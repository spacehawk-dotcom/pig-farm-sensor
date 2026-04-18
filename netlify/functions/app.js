const axios = require('axios');
const crypto = require('crypto');

const ACCESS_ID = 'vfdhuhsr8f4n53m7mcep';
const ACCESS_SECRET = '32778d3a7e8841c9abe044bf0559d797';

// 🌟 한국 농장은 대부분 US 서버를 사용합니다. (이전 eu 서버에서 us로 변경했습니다)
const BASE_URL = 'https://openapi.tuyaus.com'; 

// [1단계] 투야 임시 출입증(토큰) 발급받기
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
    
    if (!res.data.success) throw new Error("출입증 발급 거절: " + res.data.msg);
    return res.data.result.access_token;
}

// [2단계] 출입증을 보여주고 온도 가져오기
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
    
    if (!res.data.success) throw new Error("온도 조회 거절: " + res.data.msg);
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
        // 출입증 발급 시작!
        const token = await getTuyaToken(); 
        const results = {};

        // 6개 구역 돌면서 온도/습도 측정
        for (const device of devices) {
            try {
                const status = await getDeviceStatus(device.id, token);
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

        // 파이어베이스 창고에 최종 저장
        const firebaseURL = "https://sungamfarm-default-rtdb.firebaseio.com/sensor_logs.json";
        await axios.put(firebaseURL, results);
        
        return { statusCode: 200, body: JSON.stringify({ message: "성암농장 데이터 배달 완료!", data: results }) };

    } catch (error) {
        console.error("전체 에러:", error);
        return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
    }
};