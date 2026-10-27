// Shared ventilation calculations for both screens.
(function(root) {
const BASE_TEMPERATURE = 24;
const DEFAULT_VENTILATION_COEFFICIENT = 0.4;
function ventilationCoefficient(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10
        ? value : DEFAULT_VENTILATION_COEFFICIENT;
}
const FAN_AIRFLOW = Object.freeze({ fan500: 6960, fan800: Math.round(10574 * 1.69901082) });
        function calculateWeight(age) {
            let w = 5;
            if (age <= 21) { w = 5 + (age / 21) * 2; }
            else if (age <= 70) { w = 7 + ((age - 21) / 49) * 23; }
            else if (age <= 180) { w = 30 + ((age - 70) / 110) * 85; }
            else { w = 110; }
            // 기존 성장곡선에 110kg 상한 적용: 180일 전후에 체중이 하락하지 않는다.
            return parseFloat(Math.min(110, w).toFixed(1));
        }

        const DAY_MS = 86400000;
        const koreanDay = value => Math.floor((new Date(value).getTime() + 9 * 3600000) / DAY_MS);
        function dateDay(value) {
            if (value == null || value === '') return null;
            if (value instanceof Date) return Number.isFinite(value.getTime()) ? koreanDay(value) : null;
            if (typeof value === 'object') {
                if (typeof value.toDate === 'function') return dateDay(value.toDate());
                if (Number.isFinite(value.seconds)) return koreanDay(value.seconds * 1000);
                return null;
            }
            const text = String(value).trim();
            const match = text.match(/^(\d{4}|\d{2})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/)
                || text.match(/^(\d{4})(\d{2})(\d{2})$/) || text.match(/^(\d{2})(\d{2})(\d{2})$/);
            if (!match) return null;
            const year = Number(match[1]) + (match[1].length === 2 ? 2000 : 0);
            const month = Number(match[2]), day = Number(match[3]);
            const time = Date.UTC(year, month - 1, day), date = new Date(time);
            return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? time / DAY_MS : null;
        }
        function firstDateDay(values) {
            for (const value of values) { const day = dateDay(value); if (day !== null) return day; }
            return null;
        }
        function calculateBatchCount(data) {
            // Occupied pens are authoritative; an explicit zero must not fall through to stale totals.
            if (Array.isArray(data.penDetails) && data.penDetails.length)
                return data.penDetails.reduce((sum, value) => sum + (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0), 0);
            for (const value of [data.pigs, data.count, data.currentCount, data.totalPigs]) {
                if (value != null && String(value).trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0) return Number(value);
            }
            return 0;
        }
        function calculatePigAge(data, type, now = Date.now()) {
            const today = koreanDay(now);
            let age = null, sourceMsg = '', diffDays = null, stockDiffDays = null;
            const penDates = Array.isArray(data.penDates) ? data.penDates : [];
            const penDetails = Array.isArray(data.penDetails) ? data.penDetails : [];
            const occupiedDates = penDetails.length ? penDates.filter((_, i) => Number(penDetails[i]) > 0) : penDates;
            const rawStockDay = firstDateDay(type === '육성사'
                ? [data.date, ...occupiedDates, data.moveDate, data.inDate, data.stockDate, data.startDate, data.growerInDate]
                : [...occupiedDates, data.date, data.moveDate, data.inDate]);
            // The grower stocking date affects acclimatization only, not biological age.
            const stockDay = type === '육성사' && Object.prototype.hasOwnProperty.call(data, 'growerInDate')
                ? dateDay(data.growerInDate) : rawStockDay;
            if (stockDay !== null) stockDiffDays = Math.max(0, today - stockDay);

            const baseAge = type === '육성사' && Number(data.id) === 8 ? 1 : 20;
            let weightedAge = 0, datedCount = 0;
            for (let i = 0; i < penDetails.length; i++) {
                const count = Number(penDetails[i]);
                if (!Number.isInteger(count) || count <= 0) continue;
                const day = firstDateDay([penDates[i], data.weaningDate, data.date]);
                if (day === null || day > today) continue;
                weightedAge += (today - day + baseAge) * count;
                datedCount += count;
            }
            if (datedCount > 0) {
                age = Math.round(weightedAge / datedCount);
                diffDays = age - baseAge;
                sourceMsg = `사육현황 칸별 일령(이유일 +${baseAge}일) × 현재 두수 가중평균`;
                const total = calculateBatchCount(data);
                if (datedCount < total) sourceMsg += ` · 날짜 확인 ${datedCount}/${total}두`;
            }
            if (age === null) {
                for (const key of ['avgAge', 'averageAge', 'currentAge', 'age']) {
                    if (data[key] != null && String(data[key]).trim() !== '' && Number.isFinite(Number(data[key])) && Number(data[key]) > 0) {
                        age = Number(data[key]); sourceMsg = `DB 일령(${key}) 적용 · 칸별 날짜 없음`; break;
                    }
                }
            }
            if (age === null) {
                const birthDay = dateDay(data.birthDate);
                if (birthDay !== null && birthDay <= today) { age = today - birthDay; sourceMsg = '출생일 기준 역산'; }
            }
            if (age === null) {
                const day = firstDateDay([data.weaningDate, data.date]);
                if (day !== null && day <= today) {
                    diffDays = today - day; age = diffDays + baseAge;
                    sourceMsg = `사육현황 공통 이유일 기준(+${baseAge})`;
                }
            }
            if (age === null || !Number.isFinite(age) || age < 0) { age = 30; sourceMsg = '일령 날짜 없음 (기본 30일)'; }
            return {age: Math.round(age), sourceMsg, diffDays, stockDiffDays};
        }

        function calculateOptimalSettings(age, weight, count, historyStats, roomType = '육성사', stockDiffDays = null, outdoorTempHistory = [], overrides = null) {

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
                    acclimatizationMsg = `<li class="text-orange-600 bg-orange-50 p-2 sm:p-3 rounded-lg border border-orange-100 mt-2 list-none shadow-sm text-[11px] sm:text-xs"><strong class="flex items-center gap-1 mb-1"><span class="text-sm sm:text-lg">🌡️</span> 입식 적응 온도 보상 (+1℃)</strong>현재 <strong>입식 ${stockDiffDays}일차</strong>입니다. 4~6일차에 해당하여 <strong>기준온도 +1℃</strong>를 적용합니다. 7일차부터 입식 보상을 해제하고 기준온도로 복귀합니다. 외기 온도에 따른 추가 보정은 없습니다.</li>`;
                } else {
                    acclimatizationMsg = `<li class="text-slate-700 text-[11px] sm:text-xs"><strong>입식 적응 완료 · 기준온도 적용</strong>: 육성사 입식 후 ${stockDiffDays}일이 경과하여 입식 온도 보상 없이 기준온도를 적용합니다. 외기 온도에 따른 추가 보정은 없습니다.</li>`;
                }
            }

            let outdoorMsg = "";
            if (outdoorTempHistory && outdoorTempHistory.length > 0) {
                // 호출부에서 실제 최근 48시간의 외기 기록만 전달한다.
                const outdoorMax = Math.max(...outdoorTempHistory);
                const outdoorMin = Math.min(...outdoorTempHistory);
                const outdoorRange = `최근 48시간 외기 최고 ${outdoorMax.toFixed(1)}℃ / 최저 ${outdoorMin.toFixed(1)}℃`;
                outdoorMsg = `<li class="text-slate-700 text-[11px] sm:text-xs"><strong>외기 기록 (참고)</strong>: ${outdoorRange}. 외기 온도에 따른 설정온도 보정은 적용하지 않습니다.</li>`;
            }

            // 1그룹 온도에 연동하여 그룹별 개입 간격 유지
            let t_500_2 = t_500_1; // 2그룹: 1그룹과 같은 기준 온도
            let t_800_1 = t_500_1 + 2; // 3그룹: +2도
            let t_800_2 = t_500_1 + 5; // 4그룹: +5도

            let diff_500_1 = 4;  // 1그룹 편차 4
            let diff_500_2 = 4;  // 2그룹 편차 4
            let diff_800_1 = 3;  // 3그룹 편차 3
            let diff_800_2 = 2;  // 4그룹 편차 2

            let width = 11.5, length = 28.0, height = 2.2, inletGapArea = 0.2 * 26;
            let fan_500_1_cap = FAN_AIRFLOW.fan500 * 2;
            let fan_500_2_cap = FAN_AIRFLOW.fan500 * 3;
            let fan_800_1_cap = FAN_AIRFLOW.fan800 * 2;
            let fan_800_2_cap = FAN_AIRFLOW.fan800 * 2;

            if (roomType === '이유사') {
                width = 9.0; length = 15.0; height = 2.2; inletGapArea = 1.0;
                fan_500_2_cap = 0; fan_800_1_cap = 0; fan_800_2_cap = 0;
            }

            const crossSectionArea = (roomType === '육성사' ? length : width) * height;
            const buildingVolume = width * height * length;

            const coefficient = ventilationCoefficient(overrides?.coefficient);
            let baseMinVentCMH = weight * count * coefficient;
            if (baseMinVentCMH < buildingVolume * 1.5) baseMinVentCMH = buildingVolume * 1.5;

            // 요구 환기량을 충족하는 가동률을 1%p 단위로 올림한다. 이유사는 1그룹만 계산한다.
            const minimumFanCapacity = fan_500_1_cap + fan_500_2_cap;
            const minimumRate = Math.min(100, Math.ceil(baseMinVentCMH * 100 / minimumFanCapacity));
            const min_500_1 = minimumRate;
            const min_500_2 = fan_500_2_cap > 0 ? minimumRate : 0;
            let max_800_2 = Math.round(Math.max(50.0, Math.min(100.0, 50.0 + (weight * 0.4))));

            let historyMsg = `<li><strong>기본 기준 ${BASE_TEMPERATURE}℃ · 조건별 자동 적용</strong>: 일령에 따른 기준 ${Math.round(Math.max(BASE_TEMPERATURE, Math.min(32, t_500_1_raw)))}℃에 입식 경과일을 반영합니다.</li>`;
            if (acclimatizationMsg) historyMsg += acclimatizationMsg;
            if (outdoorMsg) historyMsg += outdoorMsg;

            let min_cmh = (fan_500_1_cap * min_500_1 + fan_500_2_cap * min_500_2) / 100;
            const minShortfallCMH = Math.max(0, baseMinVentCMH - min_cmh);
            const minimumGroups = roomType === '이유사' ? '1그룹' : '1·2그룹 각각';
            const minimumStatus = minShortfallCMH > 0
                ? `${minimumGroups} 100% 적용. 최소 요구량 대비 ${Math.ceil(minShortfallCMH).toLocaleString()} m³/h 부족합니다.`
                : `${minimumGroups} 계산 가동률 ${minimumRate}% 적용. 최소 요구량을 충족하도록 1%p 단위로 올림한 값입니다.`;
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

            return applyOverrides({
                f500_1: { t: Math.round(t_500_1), min: Math.round(min_500_1), max: 100, diff: diff_500_1 },
                f500_2: { t: Math.round(t_500_2), min: min_500_2, max: 100, diff: diff_500_2 },
                f800_1: { t: Math.round(t_800_1), min: 0, max: 100, diff: diff_800_1 },
                f800_2: { t: Math.round(t_800_2), min: 0, max: Math.round(max_800_2), diff: diff_800_2 },
                historyMsg, volume: buildingVolume, crossSectionArea, minVel: min_velocity, maxVel: max_velocity,
                minRequiredCMH: baseMinVentCMH, minSuppliedCMH: min_cmh, minShortfallCMH, minimumStatus,
                coefficient,
                recommendedMinimum: {
                    f500_1: { rate: min_500_1, cmh: fan_500_1_cap * min_500_1 / 100 },
                    f500_2: { rate: min_500_2, cmh: fan_500_2_cap * min_500_2 / 100 }
                },
                optMaxVel: optimal_max_vel, inletArea: inletGapArea, inletMaxVel: inletMaxVel, roomType: roomType,
                caps: { c1: fan_500_1_cap, c2: fan_500_2_cap, c3: fan_800_1_cap, c4: fan_800_2_cap },
            }, overrides);
        }

function applyOverrides(calculated, overrides) {
    const result = { ...calculated };
    for (const key of ['f500_1','f500_2','f800_1','f800_2']) result[key] = { ...calculated[key] };
    const changed = [];
    for (const key of ['f500_1','f500_2','f800_1','f800_2']) {
        if (calculated.roomType === '이유사' && key !== 'f500_1') continue;
        for (const field of key === 'f800_2' ? ['t','max','diff'] : ['t','min','diff']) {
            const value = overrides?.[key]?.[field];
            if (typeof value !== 'number' || !Number.isInteger(value) || (field === 't' ? value < 5 || value > 40 : field === 'diff' ? value < 1 || value > 20 : value < 0 || value > 100)) continue;
            result[key][field] = value;
            changed.push(key + '.' + field);
        }
    }
    result.hasManualOverrides = changed.length > 0;
    result.manualFields = changed;
    if (changed.length) {
        result.minSuppliedCMH = (result.caps.c1 * result.f500_1.min + result.caps.c2 * result.f500_2.min + result.caps.c3 * result.f800_1.min) / 100;
        result.minShortfallCMH = Math.max(0, result.minRequiredCMH - result.minSuppliedCMH);
        result.minVel = result.minSuppliedCMH / 3600 / result.crossSectionArea;
        result.minimumStatus = `저장된 최소 전압 설정 적용: 1그룹 ${result.f500_1.min}%, 2그룹 ${result.f500_2.min}%, 3그룹 ${result.f800_1.min}%. 표시 풍량은 제원 비례 추정이며 실제 풍량이 아닙니다.`;
        result.historyMsg += '<li><strong>배치별 수정 설정 적용</strong>: 직접 변경한 온도·환기·편차 값은 사육현황과 공유됩니다. 수정하지 않은 항목은 계산값을 사용합니다.</li>';
    }
    return result;
}

function recentOutdoorTemperatures(readings, now = Date.now()) {
    return readings.filter(r => r.time > now - 48 * 60 * 60 * 1000 && r.time <= now && Number.isFinite(r.temp)).map(r => r.temp);
}
root.FarmVentilation = Object.freeze({ BASE_TEMPERATURE, DEFAULT_VENTILATION_COEFFICIENT, ventilationCoefficient, FAN_AIRFLOW, calculateWeight, calculateBatchCount, calculatePigAge, calculateOptimalSettings, recentOutdoorTemperatures, applyOverrides });
})(globalThis);
