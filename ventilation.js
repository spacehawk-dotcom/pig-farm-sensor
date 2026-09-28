// Shared ventilation calculations for both screens.
(function(root) {
const BASE_TEMPERATURE = 22;
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
            
            // 명시한 육성사 입식일은 적응 기간에 사용하며, 기존 일령 계산용 날짜는 유지한다.
            // 빈 문자열은 사용자가 입식일을 지운 상태이므로 기존 날짜로 대체하지 않는다.
            const stockingDateValue = type === '육성사' && Object.prototype.hasOwnProperty.call(data, 'growerInDate')
                ? data.growerInDate : rawStockDate;
            if (stockingDateValue) {
                const stockDate = parseDate(stockingDateValue);
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

        function calculateOptimalSettings(age, weight, count, historyStats, roomType = '육성사', stockDiffDays = null, outdoorTempHistory = []) {
            
            // 1그룹 (500휀 2대 상시 - 1도 단위)
            let t_500_1_raw = BASE_TEMPERATURE;
            if (age <= 21) t_500_1_raw = 28.0 - (age * 0.1);
            else if (age <= 70) t_500_1_raw = 25.9 - ((age - 21) * 0.06);
            let t_500_1 = Math.round(Math.max(BASE_TEMPERATURE, Math.min(32.0, t_500_1_raw)));

            let acclimatizationMsg = "";

            if (roomType === '육성사' && stockDiffDays !== null && stockDiffDays >= 0) {
                // 앱에 표시하는 입식 경과일 기준: 당일(0일차)~3일차 +2, 4~6일차 +1.
                if (stockDiffDays <= 3) {
                    t_500_1 += 2; 
                    acclimatizationMsg = `<li class="text-rose-600 bg-rose-50 p-2 sm:p-3 rounded-lg border border-rose-100 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong class="flex items-center gap-1 mb-1"><span class="text-sm sm:text-lg">🌡️</span> 입식 초기 온도 보상 (+2℃)</strong>현재 <strong>${stockDiffDays === 0 ? '입식 당일(0일차)' : '입식 ' + stockDiffDays + '일차'}</strong>입니다. 입식 당일부터 3일차까지 <strong>기준온도 +2℃</strong>를 적용합니다. 4~6일차에는 +1℃, 7일차부터는 기준온도를 적용합니다.</li>`;
                } else if (stockDiffDays <= 6) {
                    t_500_1 += 1; 
                    acclimatizationMsg = `<li class="text-orange-600 bg-orange-50 p-2 sm:p-3 rounded-lg border border-orange-100 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong class="flex items-center gap-1 mb-1"><span class="text-sm sm:text-lg">🌡️</span> 입식 적응 온도 보상 (+1℃)</strong>현재 <strong>입식 ${stockDiffDays}일차</strong>입니다. 4~6일차에 해당하여 <strong>기준온도 +1℃</strong>를 적용합니다. 7일차부터 입식 보상을 해제하고 기준온도로 복귀합니다. 외기 조건에 따른 보정은 별도로 적용됩니다.</li>`;
                } else {
                    acclimatizationMsg = `<li class="text-slate-700 text-[11px] sm:text-xs"><strong>입식 적응 완료 · 기준온도 적용</strong>: 육성사 입식 후 ${stockDiffDays}일이 경과하여 입식 온도 보상 없이 기준온도를 적용합니다. 외기 조건에 따른 보정은 별도로 적용됩니다.</li>`;
                }
            }

            let outdoorMsg = "";
            if (outdoorTempHistory && outdoorTempHistory.length > 0) {
                // 호출부에서 실제 최근 48시간의 외기 기록만 전달한다.
                const outdoorMax = Math.max(...outdoorTempHistory);
                const outdoorMin = Math.min(...outdoorTempHistory);
                const outdoorRange = `최근 48시간 외기 최고 ${outdoorMax.toFixed(1)}℃ / 최저 ${outdoorMin.toFixed(1)}℃`;
                if (outdoorMax >= 30 && outdoorMin <= 20) {
                    t_500_1 += 1;
                    outdoorMsg = `<li class="text-blue-700 bg-blue-50/80 p-2 sm:p-3 rounded-lg border border-blue-200 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong>외기 조건 1: 기준 온도 +1℃</strong><br>${outdoorRange}. 최고 30℃ 이상이면서 최저 20℃ 이하이므로 기준 온도를 1℃ 높였습니다.</li>`;
                } else if (outdoorMax <= 28 && outdoorMin <= 20) {
                    outdoorMsg = `<li class="text-slate-700 bg-slate-50 p-2 sm:p-3 rounded-lg border border-slate-200 mt-2 list-none text-[11px] sm:text-xs"><strong>외기 조건 2: 기준 온도 유지</strong><br>${outdoorRange}. 최고 28℃ 이하이면서 최저 20℃ 이하이므로 외기 보정 없이 기준 온도를 유지합니다.</li>`;
                } else {
                    outdoorMsg = `<li class="text-slate-700 text-[11px] sm:text-xs"><strong>외기 보정 없음</strong>: ${outdoorRange}. 지정된 보정 조건에 해당하지 않아 기준 온도를 유지합니다.</li>`;
                }
            }

            // 1그룹 온도에 연동하여 그룹별 개입 간격 유지
            let t_500_2 = t_500_1; // 2그룹: 1그룹과 같은 기준 온도
            let t_800_1 = t_500_1 + 4; // 3그룹: +4도
            let t_800_2 = t_500_1 + 7; // 4그룹: +7도

            let diff_500_1 = 4;  // 1그룹 편차 4
            let diff_500_2 = 4;  // 2그룹 편차 4
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

            // 1·2그룹은 20%를 하한으로 함께 증량한다. 이유사는 사용 중인 1그룹만 계산한다.
            const minimumFanCapacity = fan_500_1_cap + fan_500_2_cap;
            const minimumRate = Math.min(100, Math.max(20, Math.ceil(baseMinVentCMH * 100 / minimumFanCapacity)));
            const min_500_1 = minimumRate;
            const min_500_2 = fan_500_2_cap > 0 ? minimumRate : 0;
            let max_800_2 = Math.round(Math.max(50.0, Math.min(100.0, 50.0 + (weight * 0.4))));

            let historyMsg = `<li><strong>기본 기준 ${BASE_TEMPERATURE}℃ · 조건별 자동 적용</strong>: 일령에 따른 기준 ${Math.round(Math.max(BASE_TEMPERATURE, Math.min(32, t_500_1_raw)))}℃에 입식 경과일과 최근 48시간 외기 조건을 반영합니다.</li>`;
            if (acclimatizationMsg) historyMsg += acclimatizationMsg;
            if (outdoorMsg) historyMsg += outdoorMsg;

            let min_cmh = (fan_500_1_cap * min_500_1 + fan_500_2_cap * min_500_2) / 100;
            const minShortfallCMH = Math.max(0, baseMinVentCMH - min_cmh);
            const minimumGroups = roomType === '이유사' ? '1그룹' : '1·2그룹 각각';
            const minimumStatus = minShortfallCMH > 0
                ? `${minimumGroups} 100% 적용. 최소 요구량 대비 ${Math.ceil(minShortfallCMH).toLocaleString()} m³/h 부족합니다.`
                : minimumRate > 20
                    ? `${minimumGroups} 기본 20% → ${minimumRate}%로 증량하여 최소 요구량을 충족합니다.`
                    : `${minimumGroups} 기본 20%를 유지하며 최소 요구량을 충족합니다.`;
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
                f500_2: { t: Math.round(t_500_2), min: min_500_2, max: 100, diff: diff_500_2 },
                f800_1: { t: Math.round(t_800_1), min: 0, max: 100, diff: diff_800_1 },
                f800_2: { t: Math.round(t_800_2), min: 0, max: Math.round(max_800_2), diff: diff_800_2 },
                historyMsg, volume: buildingVolume, minVel: min_velocity, maxVel: max_velocity,
                minRequiredCMH: baseMinVentCMH, minSuppliedCMH: min_cmh, minShortfallCMH, minimumStatus,
                optMaxVel: optimal_max_vel, inletArea: inletGapArea, inletMaxVel: inletMaxVel, roomType: roomType,
                caps: { c1: fan_500_1_cap, c2: fan_500_2_cap, c3: fan_800_1_cap, c4: fan_800_2_cap },
            };
        }

function recentOutdoorTemperatures(readings, now = Date.now()) {
    return readings.filter(r => r.time > now - 48 * 60 * 60 * 1000 && r.time <= now && Number.isFinite(r.temp)).map(r => r.temp);
}
root.FarmVentilation = Object.freeze({ BASE_TEMPERATURE, FAN_AIRFLOW, calculateWeight, calculatePigAge, calculateOptimalSettings, recentOutdoorTemperatures });
})(globalThis);
