const axios = require('axios');
const crypto = require('crypto');

// 🌟 보안 핵심: 털리면 안 되는 투야(Tuya) 비밀번호만 금고에서 꺼내옵니다.
const ACCESS_ID = process.env.TUYA_ACCESS_ID;
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;

// 🌟 파이어베이스 열쇠는 원래 공개용이므로 직접 입력해 에러를 방지합니다.
const FIREBASE_API_KEY = "AIzaSyBlptGu2gTAQKVy_yDomKkNEd_el6c1PL0"; 
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

async function getFarmData(collection, batchNumber, idToken) {
    try {
        if (!idToken) return { count: 0, dateRange: "--" }; // 출입증 없으면 패스

        const url = `https://firestore.googleapis.com/v1/projects/sungamfarm/databases/(default)/documents/farms/sungamfarm/${collection}/batch_${batchNumber}`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        
        const fields = response.data.fields;
        let count = 0;
        if (fields && fields.pigs) {
            count = parseInt(fields.pigs.integerValue) || parseInt(fields.pigs.doubleValue) || 0;
        }

        let allDates = [];
        if (fields && fields.penDates && fields.penDates.arrayValue && fields.penDates.arrayValue.values) {
            fields.penDates.arrayValue.values.forEach(v => {
                if (v.stringValue && v.stringValue.trim() !== '') allDates.push(v.stringValue);
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
        return { count: 0, dateRange: "--" };
    }
}

exports.handler = async (event, context) => {
    const devices = [
        { id: 'bfe1709c2ca2d9e157eyuy', name: '이유_1배치', fbCol: 'weaning', fbBatch: 1 },
        { id: 'bf074190b83540b4d2pazp', name: '이유_2배치', fbCol: 'weaning', fbBatch: 2 },
        { id: 'bf01ce94b23576b9696uld', name: '이유_3배치', fbCol: 'weaning', fbBatch: 3 },
        { id: 'bfc20cd2af7ace2e1ashgo', name: '이유_4배치', fbCol: 'weaning', fbBatch: 4 },
        { id: 'bfb02f9bdb0fbb1ba2vcev', name: '이유_5배치', fbCol: 'weaning', fbBatch: 5 },
        { id: 'bffc0e9933819a679cmvch', name: '육성_1배치', fbCol: 'grower',  fbBatch: 1 },
        { id: 'bf58ee06fc0c104896tv51', name: '육성_2배치', fbCol: 'grower',  fbBatch: 2 },
        { id: 'bf14f794614a16cc024n1z', name: '육성_3배치', fbCol: 'grower',  fbBatch: 3 },
        { id: 'bf1faaae7e5072f78fhyzr', name: '육성_4배치', fbCol: 'grower',  fbBatch: 4 },
        { id: 'bfb668aa0470a59280kzot', name: '육성_5배치', fbCol: 'grower',  fbBatch: 5 },
        { id: 'bff5798c4d866a911090af', name: '육성_6배치', fbCol: 'grower',  fbBatch: 6 },
        { id: 'bfba0d33b943894f3eddgh', name: '육성_7배치', fbCol: 'grower',  fbBatch: 7 },
        { id: 'bf96609b8d76a4cdc0beff', name: '외부온도', fbCol: 'grower',  fbBatch: 8 }
    ];

    try {
        let firebaseIdToken = "";
        try {
            // 🌟 사육정보를 가져오기 위한 임시 출입증 발급
            const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;
            const authRes = await axios.post(authUrl, { returnSecureToken: true });
            firebaseIdToken = authRes.data.idToken;
        } catch(e) {
            console.log("출입증 발급 에러가 났지만 멈추지 않고 온도 수집을 강행합니다.");
        }

        const token = await getTuyaToken(); 
        const results = {};

        for (const device of devices) {
            const farmData = await getFarmData(device.fbCol, device.fbBatch, firebaseIdToken);
            
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

        // 🌟 이미 문이 열려있는 창고(RTDB)이므로 귀찮은 인증(?auth=...) 없이 곧바로 저장!
        await axios.put(`https://sungamfarm-default-rtdb.firebaseio.com/sensor_logs.json`, results);
        await axios.put(`https://sungamfarm-default-rtdb.firebaseio.com/history_logs/${Date.now()}.json`, results);
        
        return { statusCode: 200, body: JSON.stringify({ message: "완료", data: results }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: String(error) }) };
    }
};