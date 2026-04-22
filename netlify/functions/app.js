const axios = require('axios');
const crypto = require('crypto');

const ACCESS_ID = 'vfdhuhsr8f4n53m7mcep';
const ACCESS_SECRET = '32778d3a7e8841c9abe044bf0559d797';
const BASE_URL = 'https://openapi.tuyaeu.com'; 

// [1] 투야(Tuya) 토큰 발급
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

// [2] 투야(Tuya) 온도/습도 조회
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

// 🌟 [핵심 기능] 사장님의 '사육현황 앱(Firestore)'에서 데이터 빼오기
async function getFarmData(collection, batchNumber) {
    // 무거운 앱 대신, 가벼운 웹 주소(REST API)로 바로 접근해서 가져옵니다.
    const url = `https://firestore.googleapis.com/v1/projects/sungamfarm/databases/(default)/documents/farms/sungamfarm/${collection}/batch_${batchNumber}`;
    try {
        const response = await axios.get(url);
        const fields = response.data.fields;

        // 1. 마리수 가져오기
        const count = fields.pigs ? (parseInt(fields.pigs.integerValue) || 0) : 0;

        // 2. 입식 날짜들 모아서 가장 빠른날~늦은날 계산하기
        let allDates = [];
        if (fields.penDates && fields.penDates.arrayValue && fields.penDates.arrayValue.values) {
            fields.penDates.arrayValue.values.forEach(v => {
                if (v.stringValue && v.stringValue.trim() !== '') {
                    allDates.push(v.stringValue);
                }
            });
        }
        
        // 날짜가 안 적혀 있으면 다른 칸에서 끌어옴
        if (allDates.length === 0) {
            if (fields.date && fields.date.stringValue) allDates.push(fields.date.stringValue);
            if (fields.weaningDate && fields.weaningDate.stringValue) allDates.push(fields.weaningDate.stringValue);
        }

        let dateRange = "-- ~ --";
        if (allDates.length > 0) {
            allDates.sort(); // 날짜순 정렬
            const start = allDates[0].substring(5).replace('-', '.'); // MM.DD 형태로 변환
            const end = allDates[allDates.length - 1].substring(5).replace('-', '.');
            dateRange = start === end ? start : `${start} ~ ${end}`;
        }

        return { count, dateRange };
    } catch (error) {
        console.error(`${collection} batch_${batchNumber} 현황앱 연결 실패:`, error.message);
        return { count: 0, dateRange: "--" };
    }
}

exports.handler = async (event, context) => {
    // 🌟 사육현황앱의 어떤 컬렉션(weaning/grower)의 몇 번 배치인지 정보 추가!
    const devices = [
        { id: 'bf3a297e3c2c203b0dlq2t', name: '이유_1배치', fbCol: 'weaning', fbBatch: 1 },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치', fbCol: 'weaning', fbBatch: 2 },
        { id: 'bf93b8a56123596b3cqm5q', name: '이유_3배치', fbCol: 'weaning', fbBatch: 3 },
        { id: 'bfc20cd2af7ace2e1ashgo', name: '이유_4배치', fbCol: 'weaning', fbBatch: 4 },
        { id: 'bf9e07f0335ffd36cbakuf', name: '이유_5배치', fbCol: 'weaning', fbBatch: 5 },
        { id: 'bf4eaae9ac91ea9819nnva', name: '육성_1배치', fbCol: 'grower',  fbBatch: 1 }
    ];

    try {
        const token = await getTuyaToken(); 
        const results = {};

        for (const device of devices) {
            // [1] 사육현황 앱에서 데이터 가져오기!
            const farmData = await getFarmData(device.fbCol, device.fbBatch);
            
            // [2] 투야 센서에서 데이터 가져오기!
            try {
                const status = await getDeviceStatus(device.id, token);
                const temp = status.find(s => s.code.includes('temp'))?.value / 10 || 0;
                const humi = status.find(s => s.code.includes('humidity') || s.code.includes('humi'))?.value || 0;

                results[device.name] = {
                    temp: temp.toFixed(1),
                    humi: humi,
                    count: farmData.count,           // 사육앱 데이터 반영
                    dateRange: farmData.dateRange,   // 사육앱 데이터 반영
                    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                };
            } catch (err) {
                let errorReason = "연결실패";
                if (err.message.includes("function not support")) errorReason = "수면모드";
                results[device.name] = { 
                    temp: "--", humi: "--", 
                    count: farmData.count,           // 온도는 실패해도 사육정보는 보여줌!
                    dateRange: farmData.dateRange, 
                    timestamp: errorReason 
                };
            }
        }

        // 실시간 대시보드 업데이트
        await axios.put("https://sungamfarm-default-rtdb.firebaseio.com/sensor_logs.json", results);
        // 과거 장부 누적 업데이트
        await axios.put(`https://sungamfarm-default-rtdb.firebaseio.com/history_logs/${Date.now()}.json`, results);
        
        return { statusCode: 200, body: JSON.stringify({ message: "온도 및 사육앱 데이터 융합 성공!" }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
    }
};