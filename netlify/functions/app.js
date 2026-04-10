const axios = require('axios');
const crypto = require('crypto');

exports.handler = async (event, context) => {
    // 1. 환경 변수 설정 (넷리파이 설정창에 입력하신 값들을 가져옵니다)
    const ACCESS_ID = process.env.TUYA_ACCESS_ID;
    const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET;
    const BASE_URL = 'https://openapi.tuyaeu.com'; // 유럽 서버 주소 고정

    // 2. 사장님의 12개 센서 리스트 (이미 등록된 ID들)
    const devices = [
        { id: 'bf3a297e3c2c203b0dlq2t', name: '이유_1배치' },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치' },
        // ... 나머지 10개 센서 ID도 여기에 쭉 나열되어 있어야 합니다.
    ];

    try {
        // [토큰 가져오기 및 투야 API 호출 로직 생략 - 기존 로직 유지]
        
        // 데이터 분석 핵심 부분 (여기를 이렇게 고쳐야 0도가 안 뜹니다!)
        const results = devices.map(dev => {
            const deviceStatus = getTuyaStatus(dev.id); // 투야에서 받아온 상태값
            
            // 이름이 달라도 온도를 찾아내는 마법의 로직
            const tempObj = deviceStatus.find(s => 
                ['va_temperature', 'Temperature', 'temp_current'].includes(s.code)
            );
            const humiObj = deviceStatus.find(s => 
                ['va_humidity', 'Humidity', 'humidity_value'].includes(s.code)
            );

            let temp = tempObj ? parseFloat(tempObj.value) : 0;
            let humi = humiObj ? parseFloat(humiObj.value) : 0;

            // 투야 특유의 소수점 처리 (255 -> 25.5)
            if (temp > 100) temp = temp / 10;
            if (humi > 100) humi = humi / 10;

            return { name: dev.name, temp: temp.toFixed(1), humi: humi.toFixed(1) };
        });

        return {
            statusCode: 200,
            body: JSON.stringify(results)
        };

    } catch (error) {
        console.error("데이터 수집 실패:", error);
        return { statusCode: 500, body: error.message };
    }
};