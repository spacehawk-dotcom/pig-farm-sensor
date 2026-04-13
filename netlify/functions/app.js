// 1. 최상단에 admin 설정 확인 (실시간 DB용)
const db = admin.database(); 

exports.handler = async (event, context) => {
    // ... (ACCESS_ID, ACCESS_SECRET 설정 부분은 그대로 두세요) ...

    const devices = [
        { id: 'bf3a297e3c2c203b0dlq2t', name: '이유_1배치' },
        { id: 'bfd2815413e3900144gwjv', name: '이유_2배치' },
        { id: 'bf93b8a56123596b3cqm5q', name: '이유_3배치' },
        { id: 'bfc20cd2af7ace2e1ashgo', name: '이유_4배치' },
        { id: 'bf9e07f0335ffd36cbakuf', name: '이유_5배치' },
        { id: 'bf4eaae9ac91ea9819nnva', name: '육성_1배치' }
    ];

    try {
        const results = {};

        // 모든 기기에서 온도/습도를 순서대로 가져옵니다.
        for (const device of devices) {
            try {
                // 투야 API 호출 (헤더 생성 함수 getHeaders는 기존 것 사용)
                const response = await axios.get(
                    `${BASE_URL}/v1.0/devices/${device.id}/status`,
                    { headers: getHeaders(`${BASE_URL}/v1.0/devices/${device.id}/status`) }
                );

                const status = response.data.result;
                
                // 투야 데이터에서 온도와 습도 값을 찾아냅니다.
                const temp = status.find(s => s.code.includes('temp'))?.value / 10 || 0;
                const humi = status.find(s => s.code.includes('humidity'))?.value || 0;

                // 🌟 [핵심] env.html이 기다리는 구역 이름을 키값으로 설정!
                results[device.name] = {
                    temp: temp.toFixed(1), // "25.4" 형식
                    humi: humi,            // "60" 형식
                    timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                };

            } catch (err) {
                console.error(`${device.name} 가져오기 실패:`, err.message);
                // 실패 시 앱 화면에 '연결실패'라고 빨간색으로 뜨게 합니다.
                results[device.name] = {
                    temp: "--",
                    humi: "--",
                    timestamp: "연결실패"
                };
            }
        }

        // 2. 사장님의 실시간 창고(sensor_logs)에 통째로 덮어쓰기!
        await db.ref('sensor_logs').set(results);
        
        return { 
            statusCode: 200, 
            body: JSON.stringify({ message: "성암농장 데이터 배달 완료!", data: results }) 
        };

    } catch (error) {
        console.error("전체 공정 에러:", error);
        return { statusCode: 500, body: error.message };
    }
};