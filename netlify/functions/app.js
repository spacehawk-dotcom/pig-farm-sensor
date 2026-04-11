<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>성암농장 실시간 관리</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .readonly-cell { background-color: #f3f4f6; transition: background-color 0.3s; }
    .status-badge { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body class="bg-gray-50 p-4 md:p-8">

  <div class="max-w-5xl mx-auto">
    <header class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-gray-900">🏠 성암농장 모니터링</h1>
        <p class="text-gray-500">투야 유럽 서버 전용 (고창 성암농장)</p>
      </div>
      <div id="system-status" class="bg-blue-100 text-blue-800 px-4 py-2 rounded-full font-semibold text-sm status-badge">
        🔵 데이터 수집 대기 중...
      </div>
    </header>

    <div class="bg-white rounded-xl shadow-md overflow-hidden border border-gray-200">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-green-600 text-white text-sm">
            <th class="p-4">돈사 구역</th>
            <th class="p-4 text-center">온도 🌡️</th>
            <th class="p-4 text-center">습도 💧</th>
            <th class="p-4 text-center">갱신 시간</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200" id="sensor-table">
          </tbody>
      </table>
    </div>
  </div>

  <script>
    // 1. 센서 이름 리스트 (서버에서 보내주는 이름과 100% 일치)
    const sensorNames = [
      '이유_1배치', '이유_2배치', '이유_3배치', '이유_4배치', '이유_5배치',
      '육성_1배치', '육성_2배치', '육성_3배치', '육성_4배치', '육성_5배치', '육성_6배치', '외부온도'
    ];

    const tableBody = document.getElementById('sensor-table');
    
    // 2. 테이블 뼈대 생성 (안전한 ID 부여)
    sensorNames.forEach(name => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="p-4 font-bold text-gray-900">${name}</td>
        <td class="p-4 text-center readonly-cell border-l">
            <span id="${name}-temp" class="text-2xl font-bold text-red-600">--</span> °C
        </td>
        <td class="p-4 text-center readonly-cell border-l">
            <span id="${name}-humi" class="text-xl font-bold text-blue-500">--</span> %
        </td>
        <td class="p-4 text-center text-sm text-gray-500 readonly-cell border-l" id="${name}-time">
            대기 중...
        </td>
      `;
      tableBody.appendChild(row);
    });

    // 3. 데이터 가져오기 로직 (안전장치 대폭 강화)
    async function fetchTuyaData() {
      console.log("데이터 갱신 요청 중...");
      const statusBadge = document.getElementById('system-status');

      try {
        const response = await fetch('/.netlify/functions/app');
        
        if (!response.ok) {
          throw new Error(`서버 응답 오류 (상태 코드: ${response.status})`);
        }
        
        const data = await response.json();
        console.log("도착한 데이터:", data);

        // [안전장치 1] 데이터가 리스트(배열) 형태가 아니면 중단
        if (!Array.isArray(data)) {
            throw new Error("서버에서 받은 데이터 형식이 올바르지 않습니다.");
        }

        const now = new Date().toLocaleTimeString();
        statusBadge.innerHTML = '🟢 실시간 연결 중';
        statusBadge.className = 'bg-green-100 text-green-800 px-4 py-2 rounded-full font-semibold text-sm status-badge';

        // 4. 화면 업데이트
        data.forEach(sensor => {
          // [안전장치 2] 데이터가 꼬여서 이름이 없으면 건너뜀
          if (!sensor || !sensor.name) return; 

          const tempEl = document.getElementById(`${sensor.name}-temp`);
          const humiEl = document.getElementById(`${sensor.name}-humi`);
          const timeEl = document.getElementById(`${sensor.name}-time`);

          // [안전장치 3] 값 유효성 검사 (0은 통신 에러로 간주하여 처리)
          const isValidTemp = sensor.temp !== undefined && sensor.temp !== null && sensor.temp != 0;
          const isValidHumi = sensor.humi !== undefined && sensor.humi !== null && sensor.humi != 0;

          if (tempEl) {
            tempEl.innerText = isValidTemp ? sensor.temp : "--";
          }
          if (humiEl) {
            humiEl.innerText = isValidHumi ? sensor.humi : "--";
          }
          if (timeEl && isValidTemp) {
            // 온도가 정상일 때만 시간을 찍어줌
            timeEl.innerText = now;
            timeEl.classList.remove("text-gray-500");
            timeEl.classList.add("text-green-600");
          }
        });

      } catch (error) {
        console.error("데이터 수집 실패:", error);
        statusBadge.innerHTML = '🔴 연결 끊김 (자동 재접속 시도 중)';
        statusBadge.className = 'bg-red-100 text-red-800 px-4 py-2 rounded-full font-semibold text-sm';
      }
    }

    // 초기 실행은 2초 딜레이 (화면 렌더링 후 안정적으로 가져오기)
    setTimeout(fetchTuyaData, 2000);
    // 1분(60000ms)마다 데이터 갱신
    setInterval(fetchTuyaData, 60000);
  </script>
</body>
</html>