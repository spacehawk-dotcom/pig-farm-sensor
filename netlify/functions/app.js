const axios = require('axios');
const crypto = require('crypto');

exports.handler = async (event, context) => {
    // 1. 환경 변수 로드 (Netlify 설정에서 넣으신 값)
    const ACCESS_ID = process.env.TUYA_ACCESS_ID;
    const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
    const BASE_URL = "https://openapi.tuyaeu.com"; // 유럽 서버 주소

    // 2. 투야 API 서명 생성을 위한 함수
    function getSignature(method, url, body = "", t, accessToken = "") {
        const contentHash = crypto.createHash('sha256').update(body).digest('hex');
        const stringToSign = [method, contentHash, "", url].join('\n');
        const signStr = ACCESS_ID + accessToken + t + stringToSign;
        return crypto.createHmac('sha256', ACCESS_SECRET).update(signStr).digest('hex').toUpperCase();
    }

    try {
        const t = Date.now().toString();
        
        // 3. 토큰 가져오기
        const tokenUrl = "/v1.0/token?grant_type=1";
        const tokenSig = getSignature("GET", tokenUrl, "", t);
        const tokenRes = await axios.get(BASE_URL + tokenUrl, {
            headers: { 'client_id': ACCESS_ID, 'sign': tokenSig, 't': t, 'sign_method': 'HMAC-SHA256' }
        });
        const accessToken = tokenRes.data.result.access_token;

        // 4. 연결된 모든 기기 리스트 가져오기
        const devicesUrl = `/v1.0/users/${tokenRes.data.result.uid}/devices`;
        const devicesSig = getSignature("GET", devicesUrl, "", t, accessToken);
        const devicesRes = await axios.get(BASE_URL + devicesUrl, {
            headers: { 'client_id': ACCESS_ID, 'sign': devicesSig, 't': t, 'access_token': accessToken, 'sign_method': 'HMAC-SHA256' }
        });

        const devices = devicesRes.data.result;

        // 5. 각 기기별로 데이터 추출 (만능 로직)
        const farmData = devices.map(device => {
            const status = device.status || [];
            
            // 온도 찾기 (va_temperature 또는 Temperature 또는 temp_current)
            const tempObj = status.find(s => ['va_temperature', 'Temperature', 'temp_current'].includes(s.code));
            // 습도 찾기 (va_humidity 또는 Humidity 또는 humidity_value)
            const humiObj = status.find(s => ['va_humidity', 'Humidity', 'humidity_value'].includes(s.code));

            let temp = tempObj ? parseFloat(tempObj.value) : 0;
            let humi = humiObj ? parseFloat(humiObj.value) : 0;

            // 투야 특유의 10배수 처리 (예: 255 -> 25.5)
            // 단, 이미 25.5로 오는 기기는 그대로 둡니다.
            if (temp > 100) temp = temp / 10;
            if (humi > 100) humi = humi / 10;

            return {
                name: device.name,
                temperature: temp.toFixed(1),
                humidity: humi.toFixed(1),
                last_update: new Date(device.update_time * 1000).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
            };
        });

        console.log("데이터 수집 완료:", farmData);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(farmData)
        };

    } catch (error) {
        console.error("에러 발생:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};