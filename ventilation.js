// Shared by the farm dashboard and ventilation app.
(function (root) {
    "use strict";
    const FAN_AIRFLOW = Object.freeze({ fan500: 6960, fan800: Math.round(10574 * 1.69901082) });
        function calculateWeight(age) {
            let w = 5;
            if (age <= 21) { w = 5 + (age / 21) * 2; } 
            else if (age <= 70) { w = 7 + ((age - 21) / 49) * 23; } 
            else if (age <= 180) { w = 30 + ((age - 70) / 110) * 85; } 
            else { w = 115; }
            return parseFloat(w.toFixed(1));
        }

        const parseDate = (val) => {
            if (!val) return null;
            if (typeof val === 'object' && val.toDate) return val.toDate();
            if (typeof val === 'object' && val.seconds) return new Date(val.seconds * 1000); 
            
            let dStr = String(val).trim();
            let match = dStr.match(/(20\d{2}|\d{2})[-\.\/](\d{1,2})[-\.\/](\d{1,2})/);
            if (match) {
                let year = parseInt(match[1], 10);
                if (year < 100) year += 2000;
                return new Date(year, parseInt(match[2], 10) - 1, parseInt(match[3], 10));
            }

            let d = dStr.replace(/[^0-9]/g, '');
            if (d.length === 8) {
                return new Date(parseInt(d.substring(0,4), 10), parseInt(d.substring(4,6), 10) - 1, parseInt(d.substring(6,8), 10));
            } else if (d.length === 6) {
                return new Date(parseInt("20"+d.substring(0,2), 10), parseInt(d.substring(2,4), 10) - 1, parseInt(d.substring(4,6), 10));
            }
            return null;
        };

        const getFirstValidDate = (arr) => {
            if (!Array.isArray(arr)) return null;
            for (let item of arr) {
                if (parseDate(item) !== null) return parseDate(item);
            }
            return null;
        };

        function calculatePigAge(data, type) {
            let age = null; let sourceMsg = ""; 
            let diffDays = null; let stockDiffDays = null;

            let rawStockDate = null;
            if (type === '육성사') {
                rawStockDate = data.date || getFirstValidDate(data.penDates) || data.moveDate || data.inDate || data.stockDate || data.startDate || data.growerInDate || null;
            } else {
                rawStockDate = getFirstValidDate(data.penDates) || data.date || data.moveDate || data.inDate || null;
            }
            
            if (rawStockDate) {
                const stockDate = parseDate(rawStockDate);
                if (stockDate) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0); stockDate.setHours(0, 0, 0, 0);
                    stockDiffDays = Math.floor((today.getTime() - stockDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (stockDiffDays < 0) stockDiffDays = 0; 
                }
            }

            const ageKeys = ['avgAge', 'averageAge', 'currentAge', 'age'];
            for (const key of ageKeys) {
                if (data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '') {
                    age = Number(data[key]);
                    sourceMsg = `DB 일령(${key}) 적용`;
                    break;
                }
            }

            if (age === null && data.birthDate) {
                const bDate = parseDate(data.birthDate);
                if (bDate) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0); bDate.setHours(0, 0, 0, 0);
                    age = Math.floor((today.getTime() - bDate.getTime()) / (1000 * 60 * 60 * 24));
                    sourceMsg = "출생일 기준 역산";
                }
            }

            if (age === null) {
                let baseAge = (type === '육성사') ? 70 : 28;
                let targetDateStr = null;

                if (type === '육성사' && data.weaningDate && typeof data.weaningDate === 'string' && data.weaningDate.trim() !== '') { 
                    targetDateStr = data.weaningDate.trim(); 
                    baseAge = 28; 
                    sourceMsg = "이유일 기준 역산(+28)"; 
                } else if (rawStockDate) { 
                    targetDateStr = rawStockDate; 
                    sourceMsg = `입식일 기준 역산(+${baseAge})`; 
                }

                if (targetDateStr) {
                    const targetDate = parseDate(targetDateStr);
                    if (targetDate) {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0); targetDate.setHours(0, 0, 0, 0);
                        diffDays = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
                        age = diffDays + baseAge;
                    }
                }
            }

            if (age === null || isNaN(age) || age <= 0) {
                age = 30; 
                sourceMsg = "데이터 없음 (기본 30일)"; 
            }
            
            return { age: Math.round(Math.max(1, age)), sourceMsg, diffDays, stockDiffDays };
        }

        function calculateOptimalSettings(age, weight, count, historyStats, roomType = '육성사', stockDiffDays = null, outdoorTempHistory = [], manualBaseTemp = null) {
            
            // 1그룹 (500휀 2대 상시 - 1도 단위)
            let t_500_1_raw = 22.0;
            if (age <= 21) t_500_1_raw = 28.0 - (age * 0.1);
            else if (age <= 70) t_500_1_raw = 25.9 - ((age - 21) * 0.06);
            let t_500_1 = Math.round(Math.max(22.0, Math.min(32.0, t_500_1_raw)));

            let acclimatizationMsg = "";

            if (roomType === '육성사' && stockDiffDays !== null && stockDiffDays >= 0) {
                if (stockDiffDays <= 7) {
                    t_500_1 += 2; 
                    acclimatizationMsg = `<li class="text-rose-600 bg-rose-50 p-2 sm:p-3 rounded-lg border border-rose-100 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong class="flex items-center gap-1 mb-1"><span class="text-sm sm:text-lg">🌡️</span> 입식 1주차 온도 보상 (+2℃)</strong>육성사 이동 후 <strong>${stockDiffDays === 0 ? '오늘(당일)' : stockDiffDays + '일차'}</strong>입니다. 이동 및 합사 스트레스 완화, 새로운 환경 적응을 위해 <strong>권장 온도를 2℃ 상향 조정</strong>했습니다.</li>`;
                } else if (stockDiffDays <= 14) {
                    t_500_1 += 1; 
                    acclimatizationMsg = `<li class="text-orange-600 bg-orange-50 p-2 sm:p-3 rounded-lg border border-orange-100 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong class="flex items-center gap-1 mb-1"><span class="text-sm sm:text-lg">🌡️</span> 입식 2주차 온도 보상 (+1℃)</strong>육성사 이동 후 <strong>${stockDiffDays}일차</strong>입니다. 1주차(+2℃)에 이어 점진적인 정상 온도 적응을 위해 <strong>권장 온도를 1℃ 상향 조정</strong>했습니다. (15일차부터 정상 복귀)</li>`;
                }
            }

            let outdoorMsg = "";
            if (outdoorTempHistory && outdoorTempHistory.length > 0) {
                const checkLength = Math.min(outdoorTempHistory.length, 2880); // 최근 48시간
                const recentHist = outdoorTempHistory.slice(-checkLength);
                const isCold = recentHist.some(t => t <= 20.0);
                
                if (isCold) {
                    t_500_1 += 1;
                    outdoorMsg = `<li class="text-blue-700 bg-blue-50/80 p-2 sm:p-3 rounded-lg border border-blue-200 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong class="flex items-center gap-1 mb-1"><span class="text-sm sm:text-lg">❄️</span> 외기 저온 방어 모드 작동 (+1℃)</strong>최근 48시간 내 외부 온도가 20℃ 이하로 떨어진 이력이 감지되어, 돈사 내 샛바람 유입을 방어하기 위해 <strong>기준 권장 온도를 1℃ 상향 보정</strong>했습니다. (이틀 연속 20℃ 초과 시 자동 해제)</li>`;
                }
            }

            let manualMsg = "";
            if (manualBaseTemp !== null && !isNaN(manualBaseTemp)) {
                if (t_500_1 !== manualBaseTemp) {
                    manualMsg = `<li class="text-blue-700 bg-blue-100/50 p-2 sm:p-3 rounded-lg border border-blue-200 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong class="flex items-center gap-1 mb-1"><span class="text-sm sm:text-lg">⚙️</span> 수동 온도 설정 적용됨</strong>사용자가 1그룹 고정 온도를 <strong>${manualBaseTemp}℃</strong>로 수동 지정하여, 이에 맞춰 전체 그룹의 개입 온도가 재조정되었습니다. (알고리즘 권장값: ${t_500_1}℃)</li>`;
                }
                t_500_1 = Math.round(manualBaseTemp);
            }

            // 1그룹 온도에 연동하여 그룹별 개입 간격 유지
            let t_500_2 = t_500_1 + 2; // 2그룹: +2도
            let t_800_1 = t_500_1 + 4; // 3그룹: +4도
            let t_800_2 = t_500_1 + 6; // 4그룹: +6도

            let diff_500_1 = 2;
            let diff_500_2 = 3;  // 2그룹 편차 3
            let diff_800_1 = 4;  // 3그룹 편차 4
            let diff_800_2 = 2;  // 4그룹 편차 2

            let width = 11.5, length = 28.0, height = 2.2, inletGapArea = 0.2 * 28;
            let fan_500_1_cap = FAN_AIRFLOW.fan500 * 2;
            let fan_500_2_cap = FAN_AIRFLOW.fan500 * 3;
            let fan_800_1_cap = FAN_AIRFLOW.fan800 * 2;
            let fan_800_2_cap = FAN_AIRFLOW.fan800 * 2;

            if (roomType === '이유사') {
                width = 9.0; length = 15.0; height = 2.2; inletGapArea = 1.0;
                fan_500_2_cap = 0; fan_800_1_cap = 0; fan_800_2_cap = 0;
            }

            const crossSectionArea = width * height; 
            const buildingVolume = crossSectionArea * length;

            let baseMinVentCMH = weight * count * 0.5; 
            if (baseMinVentCMH < buildingVolume * 1.5) baseMinVentCMH = buildingVolume * 1.5; 

            // 표와 그래프, 유속 계산 모두 실제 표시되는 정수 가동률을 사용한다.
            let min_500_1 = Math.round(Math.max(25.0, Math.min(80.0, (baseMinVentCMH / fan_500_1_cap) * 100)));
            let max_800_2 = Math.round(Math.max(50.0, Math.min(100.0, 50.0 + (weight * 0.4))));

            let historyMsg = "";
            if (acclimatizationMsg) historyMsg += acclimatizationMsg;
            if (outdoorMsg) historyMsg += outdoorMsg;
            if (manualMsg) historyMsg += manualMsg;

            let min_cmh = fan_500_1_cap * (min_500_1 / 100); 
            let min_velocity = min_cmh / 3600 / crossSectionArea; 
            let max_cmh = fan_500_1_cap + fan_500_2_cap + fan_800_1_cap + (fan_800_2_cap * (max_800_2 / 100)); 
            let max_velocity = max_cmh / 3600 / crossSectionArea; 
            let inletMaxVel = roomType !== '이유사' ? max_cmh / 3600 / inletGapArea : 0;

            let optimal_max_vel = 0.5;
            if (age > 30 && age <= 70) optimal_max_vel = 1.0; 
            else if (age > 70) optimal_max_vel = 1.8; 
            if (weight > 90) optimal_max_vel = 2.2;
            if (roomType === '이유사') optimal_max_vel = 0.3;

            if (roomType === '이유사') {
                t_500_2 = 0; t_800_1 = 0; t_800_2 = 0;
            }

            return {
                f500_1: { t: Math.round(t_500_1), min: Math.round(min_500_1), max: 100, diff: diff_500_1 },
                f500_2: { t: Math.round(t_500_2), min: 0, max: 100, diff: diff_500_2 },
                f800_1: { t: Math.round(t_800_1), min: 0, max: 100, diff: diff_800_1 },
                f800_2: { t: Math.round(t_800_2), min: 0, max: Math.round(max_800_2), diff: diff_800_2 },
                historyMsg, volume: buildingVolume, minVel: min_velocity, maxVel: max_velocity,
                optMaxVel: optimal_max_vel, inletArea: inletGapArea, inletMaxVel: inletMaxVel, roomType: roomType,
                caps: { c1: fan_500_1_cap, c2: fan_500_2_cap, c3: fan_800_1_cap, c4: fan_800_2_cap },
            };
        }

    root.FarmVentilation = Object.freeze({ FAN_AIRFLOW, calculateWeight, calculatePigAge, calculateOptimalSettings });
})(globalThis);
