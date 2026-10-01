document.addEventListener('DOMContentLoaded', () => {
            // DOM Elements
            const inputs = {
                temp: document.getElementById('temp-slider'),
                weight: document.getElementById('weight-slider'),
                wind: document.getElementById('wind-slider'),
                humidity: document.getElementById('humidity-slider')
            };
            const values = {
                temp: document.getElementById('temp-val'),
                weight: document.getElementById('weight-val'),
                wind: document.getElementById('wind-val'),
                humidity: document.getElementById('humidity-val')
            };
            const floorRadios = document.querySelectorAll('input[name="floor"]');

            // Output Elements
            const uiEET = document.getElementById('final-eet');
            const uiBase = document.getElementById('detail-base');
            const uiWind = document.getElementById('detail-wind');
            const uiHumidity = document.getElementById('detail-humidity');
            const uiFloor = document.getElementById('detail-floor');
            const uiDiff = document.getElementById('detail-total-diff');

            const resultPanel = document.getElementById('result-panel');
            const statusBadge = document.getElementById('status-badge');
            const statusIcon = document.getElementById('status-icon');
            const statusText = document.getElementById('status-text');
            const targetTempDisplay = document.getElementById('target-temp-display');

            // 체감온도 계산 핵심 로직
            function calculateEETDetails(currentTemp, weight, windSpeed, humidity, floorCondition) {
                let windChill = 0;
                let humidityEffect = 0;
                let floorEffect = 0;

                // 1. 풍냉효과
                if (windSpeed > 0.15) {
                    let weightFactor = (150 - weight) / 100;
                    weightFactor = Math.max(0.3, Math.min(weightFactor, 1.5));
                    let speedFactor = (windSpeed - 0.15) * 10;
                    windChill = -(weightFactor * speedFactor * 1.5);
                }

                // 2. 습도 효과 보정
                // - 고온(22℃ 이상) + 고습(50% 초과): 헐떡임(호흡)에 의한 체열 발산 지연으로 더 더게 느낌 (+)
                // - 저온(18℃ 이하) + 고습(60% 초과): 습기 찬 공기와 피부 수분 증발로 체온 손실 가속 (-)
                if (currentTemp >= 22 && humidity > 50) {
                    humidityEffect = (currentTemp - 20) * ((humidity - 50) / 100) * 0.7;
                } else if (currentTemp <= 18 && humidity > 60) {
                    humidityEffect = -(20 - currentTemp) * ((humidity - 60) / 100) * 0.5;
                } else if (humidity < 40) {
                    humidityEffect = (humidity - 50) * 0.02;
                }

                // 3. 바닥효과
                const floorEffects = {
                    'dry_solid': 0,
                    'dry_slat': -1.5,
                    'wet_solid': -3.0,
                    'wet_slat': -4.5,
                    'bedding': 2.0
                };
                floorEffect = floorEffects[floorCondition] || 0;

                // 4. 최종 체감온도
                let eet = currentTemp + windChill + humidityEffect + floorEffect;

                return {
                    eet: Math.round(eet * 10) / 10,
                    windChill: Math.round(windChill * 10) / 10,
                    humidityEffect: Math.round(humidityEffect * 10) / 10,
                    floorEffect: floorEffect
                };
            }

            // 돼지 체중에 따른 대략적인 권장 적정 온도 산출 (가이드라인 용도)
            function getTargetTemp(weight) {
                let target = 34 - (weight * 0.18);
                return Math.max(16, Math.min(target, 32));
            }

            // UI 업데이트 로직
            function updateUI() {
                const temp = parseFloat(inputs.temp.value);
                const weight = parseFloat(inputs.weight.value);
                const wind = parseFloat(inputs.wind.value);
                const humidity = parseFloat(inputs.humidity.value);
                let floor = 'dry_solid';
                floorRadios.forEach(radio => {
                    if (radio.checked) floor = radio.value;
                });

                // 라벨 업데이트
                values.temp.innerText = temp.toFixed(1) + '℃';
                values.weight.innerText = weight + 'kg';
                values.wind.innerText = wind.toFixed(2) + 'm/s';
                values.humidity.innerText = humidity + '%';

                // 계산 실행
                const result = calculateEETDetails(temp, weight, wind, humidity, floor);
                const totalDiff = result.eet - temp;
                const targetTemp = getTargetTemp(weight);

                // 결과 텍스트 업데이트
                uiEET.innerText = result.eet.toFixed(1);
                uiBase.innerText = temp.toFixed(1) + '℃';

                // 편차가 +인지 -인지에 따라 색상 클래스 적용을 위한 헬퍼 함수
                const formatDiff = (val, el) => {
                    if(val > 0) {
                        el.innerText = '+' + val.toFixed(1) + '℃';
                        el.className = "font-bold text-red-600";
                    } else if (val < 0) {
                        el.innerText = val.toFixed(1) + '℃';
                        el.className = "font-bold text-blue-600";
                    } else {
                        el.innerText = '0.0℃';
                        el.className = "font-bold text-gray-500";
                    }
                };

                formatDiff(result.windChill, uiWind);
                formatDiff(result.humidityEffect, uiHumidity);
                formatDiff(result.floorEffect, uiFloor);
                formatDiff(totalDiff, uiDiff);
                targetTempDisplay.innerText = `약 ${Math.round(targetTemp-1)}℃ ~ ${Math.round(targetTemp+1)}℃`;

                // 상태별 시각적 피드백 (쾌적/추움/더움) 판별
                const tempDiffFromTarget = result.eet - targetTemp;

                resultPanel.className = "w-full md:w-1/2 p-6 md:p-8 flex flex-col justify-center relative overflow-hidden transition-all duration-500";

                if (tempDiffFromTarget < -2.5) {
                    // 추움
                    resultPanel.classList.add("bg-blue-50", "text-blue-900");
                    statusBadge.className = "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm shadow-sm bg-blue-100 text-blue-700";
                    statusIcon.className = "fa-solid fa-snowflake";
                    statusText.innerText = "계산식 비교 기준보다 낮음";
                } else if (tempDiffFromTarget > 2.5) {
                    // 더움
                    resultPanel.classList.add("bg-red-50", "text-red-900");
                    statusBadge.className = "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm shadow-sm bg-red-100 text-red-700";
                    statusIcon.className = "fa-solid fa-fire";
                    statusText.innerText = "계산식 비교 기준보다 높음";
                } else {
                    // 쾌적
                    resultPanel.classList.add("bg-green-50", "text-green-900");
                    statusBadge.className = "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm shadow-sm bg-green-100 text-green-700";
                    statusIcon.className = "fa-solid fa-check-circle";
                    statusText.innerText = "계산식 비교 기준 부근";
                }
            }

            // 이벤트 리스너 등록
            inputs.temp.addEventListener('input', updateUI);
            inputs.weight.addEventListener('input', updateUI);
            inputs.wind.addEventListener('input', updateUI);
            inputs.humidity.addEventListener('input', updateUI);
            floorRadios.forEach(radio => radio.addEventListener('change', updateUI));

            const windHelpBtn = document.getElementById('wind-help-btn');
            const windModal = document.getElementById('wind-modal');
            const windModalContent = document.getElementById('wind-modal-content');
            const windModalClose = document.getElementById('wind-modal-close');
            const windModalOk = document.getElementById('wind-modal-ok');

            const openModal = () => {
                windModal.classList.remove('hidden');
                windModal.classList.add('flex');
                // DOM 렌더링 후 애니메이션 클래스 적용
                setTimeout(() => {
                    windModal.classList.remove('opacity-0');
                    windModalContent.classList.remove('scale-95');
                }, 10);
            };

            const closeModal = () => {
                windModal.classList.add('opacity-0');
                windModalContent.classList.add('scale-95');
                setTimeout(() => {
                    windModal.classList.add('hidden');
                    windModal.classList.remove('flex');
                }, 300);
            };

            windHelpBtn.addEventListener('click', openModal);
            windModalClose.addEventListener('click', closeModal);
            windModalOk.addEventListener('click', closeModal);
            windModal.addEventListener('click', (e) => {
                if (e.target === windModal) closeModal();
            });

            document.addEventListener('keydown', event => { if(event.key === 'Escape') closeModal(); });
            // 초기 계산 실행
            updateUI();
        });

