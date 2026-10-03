/* Actual controller observations and conservative, explainable historical comparison. */
(function (root) {
    'use strict';
    const HOUR = 3600000, DAY = 24 * HOUR, BIN = 300000;
    const num = v => v == null || typeof v === 'boolean' || String(v).trim() === '' ? NaN : Number(v);
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const kst = t => new Date(t + 9 * HOUR).toISOString().slice(0, 16);
    function validate(record, now = Date.now()) {
        if (!record.room || !Array.isArray(record.groups) || record.groups.length !== 4) throw Error('배치와 4개 그룹을 확인하세요.');
        if (![record.start, record.end].every(Number.isFinite) || record.start > record.end || record.end > now || record.start < now - 366 * DAY || record.end - record.start > 7 * DAY)
            throw Error('관찰 기간은 최근 1년 이내, 최대 7일이며 종료는 현재 시각 이하여야 합니다.');
        for (const [i, g] of record.groups.entries()) {
            if (![g.t, g.min, g.max, g.diff].every(Number.isFinite) || g.t < 5 || g.t > 40 || g.diff <= 0 || g.diff > 15 || g.min < 0 || g.max > 100 || g.min > g.max)
                throw Error(`${i + 1}그룹: 온도 5~40℃, 편차 0 초과~15℃, 0 ≤ 최소 ≤ 최대 ≤ 100%를 입력하세요.`);
        }
        if (!Number.isInteger(record.count) || record.count <= 0 || !Number.isFinite(record.weight) || record.weight <= 0 || record.weight > 500 || !Number.isFinite(record.age) || record.age < 0)
            throw Error('두수·평균 체중·일령을 확인하세요.');
        if (!record.context?.trim() || record.context.length > 200) throw Error('입기구·순환·난방 상태를 200자 이내로 입력하세요.');
        if (!['normal', 'cough', 'unknown'].includes(record.observation)) throw Error('관찰 상태를 선택하세요.');
        return record;
    }
    function bins(samples) {
        const map = new Map();
        for (const p of samples) {
            const time = num(p.time), inside = num(p.inside), outside = num(p.outside);
            if (!Number.isFinite(time) || !Number.isFinite(inside) || !Number.isFinite(outside) || inside < -50 || inside > 70 || outside < -50 || outside > 70) continue;
            const key = Math.floor(time / BIN) * BIN;
            if (!map.has(key)) map.set(key, { time: key, ins: [], outs: [] });
            map.get(key).ins.push(inside); map.get(key).outs.push(outside);
        }
        return [...map.values()].map(p => ({ time: p.time, inside: mean(p.ins), outside: mean(p.outs) })).sort((a, b) => a.time - b.time);
    }
    function signature(r) { return JSON.stringify(r.groups.map(g => [g.t, g.min, g.max, g.diff])); }
    function recommend(records, samples, current) {
        const { now = Date.now(), low, high, room, weight, count, context } = current;
        if (![low, high, weight, count].every(Number.isFinite) || low >= high || weight <= 0 || count <= 0 || !context?.trim()) throw Error('목표 온도 범위와 현재 사육·설비 조건을 입력하세요.');
        const all = bins(samples);
        const recent = all.filter(p => p.time >= now - 6 * HOUR && p.time <= now);
        if (recent.length < 54 || !recent.length || now - recent.at(-1).time > 30 * 60000)
            return { candidates: [], reason: '최근 6시간의 내·외기 기록이 부족하거나 마지막 기록이 30분 이상 지났습니다.', evaluated: 0 };
        const weather = mean(recent.map(p => p.outside));
        const valid = records.filter(r => { try { validate(r, now); return r.room === room; } catch { return false; } });
        const groups = new Map();
        let evaluated = 0;
        for (const r of valid) {
            if (r.observation !== 'normal' || r.context.trim() !== context.trim() || Math.abs(r.weight / weight - 1) > .2 || Math.abs(r.count / count - 1) > .2) continue;
            // First 30 minutes after the declared start are excluded. Each window is a full six hours.
            for (let start = r.start + HOUR / 2; start + 6 * HOUR <= r.end; start += 6 * HOUR) {
                const end = start + 6 * HOUR;
                // Conflicting or duplicate observation intervals cannot count as independent evidence.
                if (valid.some(other => other !== r && other.start < end && other.end > start)) continue;
                const points = all.filter(p => p.time >= start && p.time < end);
                if (points.length < 54 || points[0].time - start > HOUR / 2 || end - points.at(-1).time > HOUR / 2 || points.some((p, i) => i && p.time - points[i - 1].time > HOUR / 2)) continue;
                const outside = mean(points.map(p => p.outside));
                if (Math.abs(outside - weather) > 3) continue;
                // Compare the same six-hour period of the day (KST), to reduce day/night confounding.
                if (Math.floor(((start + 9 * HOUR) % DAY) / (6 * HOUR)) !== Math.floor(((now - 6 * HOUR + 9 * HOUR) % DAY) / (6 * HOUR))) continue;
                let drop = 0;
                const byTime = new Map(points.map(p => [p.time, p.inside]));
                for (const p of points) if (byTime.has(p.time - HOUR)) drop = Math.max(drop, byTime.get(p.time - HOUR) - p.inside);
                const inRange = points.filter(p => p.inside >= low && p.inside <= high).length / points.length;
                const error = mean(points.map(p => Math.max(low - p.inside, p.inside - high, 0)));
                const key = signature(r), day = kst(start).slice(0, 10);
                if (!groups.has(key)) groups.set(key, { groups: r.groups, days: new Map() });
                // A day contributes at most one window to a setting; recording more often earns no extra votes.
                if (!groups.get(key).days.has(day)) groups.get(key).days.set(day, { inRange, error, drop, outside, coverage: points.length / 72 });
                evaluated++;
            }
        }
        const candidates = [...groups.values()].filter(g => g.days.size >= 3).map(g => {
            const windows = [...g.days.values()];
            return { groups: g.groups, days: g.days.size, inRange: mean(windows.map(w => w.inRange)),
                error: mean(windows.map(w => w.error)), drop: Math.max(...windows.map(w => w.drop)),
                outside: mean(windows.map(w => w.outside)), coverage: mean(windows.map(w => w.coverage)) };
        }).filter(c => c.inRange >= .8 && c.drop <= 2)
            .sort((a, b) => b.inRange - a.inRange || a.error - b.error || a.drop - b.drop);
        return { candidates: candidates.slice(0, 3), evaluated, weather,
            reason: candidates.length ? '' : '추천 보류: 같은 조건·같은 설정의 서로 다른 3일 이상 기록, 목표 범위 유지율 80% 이상, 1시간 하강 2℃ 이하를 충족한 사례가 없습니다.' };
    }
    const api = { HOUR, DAY, BIN, num, kst, validate, bins, recommend };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.VentilationLearning = api;
})(globalThis);
