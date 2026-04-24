const axios = require('axios');
const crypto = require('crypto');

const ACCESS_ID = 'vfdhuhsr8f4n53m7mcep';
const ACCESS_SECRET = '32778d3a7e8841c9abe044bf0559d797';
const BASE_URL = 'https://openapi.tuyaeu.com'; 
const FIREBASE_API_KEY = "AIzaSyBlptGu2gTAQKVy_yDomKkNEd_el6c1PL0"; // 🌟 사장님의 앱 열쇠

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
    if (!res.data.success) throw new Error("토큰 실패");
    return res.data.result.access_token;
}

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
    if (!res.data.success) throw new Error(res.data.msg);
    return res.data.result;
}

// 🌟 [핵심 변경] 파이어베이스 임시 출입증을 먼저 발급받고 데이터를 쏙 빼옵니다!
async function getFarmData(collection, batchNumber) {
    try {
        // 1. 임시 출입증(토큰) 발급받기
        const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;
        const authRes = await axios.post(authUrl, { returnSecureToken: true });
        const idToken = authRes.data.idToken;

        // 2. 출입증 보여주고 사육 데이터 가져오기
        const url = `https://firestore.googleapis.com/v1/projects/sungamfarm/databases/(default)/documents/farms/sungamfarm/${collection}/batch_${batchNumber}`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        
        const fields = response.data.fields;

        let count = 0;
        if (fields && fields.pigs) {
            // 정수, 소수점 등 어떤 형태로 저장되었든 완벽하게 읽어옵니다.
            count = parseInt(fields.pigs.integerValue) || parseInt(fields.pigs.doubleValue) || 0;
        }

        let allDates = [];
        if (fields && fields.penDates && fields.penDates.arrayValue && fields.penDates.arrayValue.values) {
            fields.penDates.arrayValue.values.forEach(v => {
                if (v.stringValue && v.stringValue.trim() !== '') {
                    allDates.push(v.stringValue);
                }
            });
        }
        
        if (allDates.length === 0 && fields) {
            if (fields.date && fields.date.stringValue) allDates.push(fields.date.stringValue);
            if (fields.weaningDate && fields.weaningDate.stringValue) allDates.push(fields.weaningDate.stringValue);
        }

        let dateRange = "--";
        if (allDates.length > 0) {
            allDates.sort(); 
            const start = allDates[0].substring(5).replace('-', '.'); 
            const end = allDates[allDates.length - 1].substring(5).replace('-', '.');
            dateRange = start === end ? start : `${start} ~ ${end}`;
        }

        return { count, dateRange };
    } catch (error) {
        console.error(`사육현황 연결 실패:`, error.message);
        return { count: 0, dateRange: "--" };
    }
}

exports.handler = async (event, context) => {
    const devices = [
        { id: 'bf3a297e3c2c203b0dlq2t', name: '이유_1배치', fbCol: 'weaning', fbBatch: 1 },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치', fbCol: 'weaning', fbBatch: 2 },
        { id: 'bf93b8a56123596b3cqm5q', name: '이유_3배치', fbCol: 'weaning', fbBatch: 3 },
        { id: 'bfc20cd2af7ace2e1ashgo', name: '이유_4배치', fbCol: 'weaning', fbBatch: 4 },
        { id: 'bf9e07f0335ffd36cbakuf', name: '이유_5배치', fbCol: 'weaning', fbBatch: 5 },
        { id: 'bf4eaae9ac91ea9819nnva', name: '육성_1배치', fbCol: 'grower',  fbBatch: 1 },
        { id: 'bfdcb1b4769d718606x5tl', name: '육성_2배치', fbCol: 'grower',  fbBatch: 2 },
        { id: 'bf71e36ffd81157c04y4un', name: '육성_3배치', fbCol: 'grower',  fbBatch: 3 },
        { id: 'bfa6ebb87756d26f748bsp', name: '육성_4배치', fbCol: 'grower',  fbBatch: 4 },
        { id: 'bfe85a2050a78a35583hf4', name: '육성_5배치', fbCol: 'grower',  fbBatch: 5 },
        { id: 'bfded2fecab7d31f6b1j7j', name: '육성_5배치', fbCol: 'grower',  fbBatch: 6 },
        { id: 'bf13f302e48b276482bzjb', name: '외부온도', fbCol: 'grower',  fbBatch: 7 }

    ];

    try {
        const token = await getTuyaToken(); 
        const results = {};

        for (const device of devices) {
            const farmData = await getFarmData(device.fbCol, device.fbBatch);
            
            try {
                const status = await getDeviceStatus(device.id, token);
                const temp = status.find(s => s.code.includes('temp'))?.value / 10 || 0;
                const humi = status.find(s => s.code.includes('humidity') || s.code.includes('humi'))?.value || 0;

                results[device.name] = {
                    temp: temp.toFixed(1), humi: humi,
                    count: farmData.count, dateRange: farmData.dateRange,
                    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                };
            } catch (err) {
                let errorReason = "연결실패";
                if (err.message.includes("function not support")) errorReason = "수면모드";
                results[device.name] = { 
                    temp: "--", humi: "--", 
                    count: farmData.count, dateRange: farmData.dateRange, timestamp: errorReason 
                };
            }
        }

        await axios.put("https://sungamfarm-default-rtdb.firebaseio.com/sensor_logs.json", results);
        await axios.put(`https://sungamfarm-default-rtdb.firebaseio.com/history_logs/${Date.now()}.json`, results);
        
        return { statusCode: 200, body: JSON.stringify({ message: "완료", data: results }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
    }
};