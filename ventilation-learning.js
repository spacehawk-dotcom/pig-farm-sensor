/* Actual controller observations and conservative, explainable historical comparison. */
(function (root) {
    'use strict';
    const HOUR = 3600000, DAY = 24 * HOUR, BIN = 300000;
    const num = v => v == null || typeof v === 'boolean' || String(v).trim() === '' ? NaN : Number(v);
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const kst = t => new Date(t + 9 * HOUR).toISOString().slice(0, 16);
    function validate(record, now = Date.now()) {
        if (record.source !== 'app_saved' || !record.room || !Array.isArray(record.groups) || record.groups.length !== 4) throw Error('자동 저장 설정이 필요합니다.');
        if (![record.start,record.end].every(Number.isFinite) || record.start >= record.end || record.end > now || record.start < now-365*DAY) throw Error('분석 기간을 확인하세요.');
        if (!record.groups.every(g=>g && [g.t,g.min,g.max,g.diff].every(Number.isFinite) && g.t>=5 && g.t<=40 && g.min>=0 && g.max<=100 && g.min<=g.max && g.diff>0 && g.diff<=20)) throw Error('그룹 설정을 확인하세요.');
        if (!Number.isInteger(record.count) || record.count<=0 || !Number.isFinite(record.weight) || record.weight<=0 || !Number.isFinite(record.age) || record.age<0) throw Error('사육 정보를 확인하세요.');
        return record;
    }
    function automaticIntervals(records, cycles, now, snapshots) {
        const selected=cycles.filter(c=>Number.isFinite(c.start) && c.start<=now && (c.end==null || Number.isFinite(c.end)&&c.end>=c.start)).sort((a,b)=>a.start-b.start);
        const rows=[];
        for(let i=0;i<selected.length;i++) {
            const c=selected[i];
            const next=selected.slice(i+1).find(n=>n.room===c.room && n.start>c.start);
            const end=Math.min(c.end??now,next?.start??now,now);
            const scoped=records.filter(r=>snapshots.valid(r) && r.start<end);
            for(const r of snapshots.intervals(scoped,{...c,end},now)) {
                const start=Math.max(r.start,now-365*DAY);
                if(r.end>start) rows.push({...r,savedStart:r.start,start});
            }
        }
        // Duplicate cycle documents cannot give a saved setting extra votes.
        return [...new Map(rows.map(r=>[r.id || `${r.room}:${r.savedStart}`,r])).values()];
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
        if (![low, high, weight, count].every(Number.isFinite) || low >= high || weight <= 0 || count <= 0) throw Error('목표 온도 범위와 현재 사육 조건을 입력하세요.');
        const all = bins(samples);
        const recent = all.filter(p => p.time >= now - 6 * HOUR && p.time <= now);
        if (recent.length < 54 || !recent.length || now - recent.at(-1).time > 30 * 60000)
            return { candidates: [], reason: '최근 6시간의 내·외기 기록이 부족하거나 마지막 기록이 30분 이상 지났습니다.', evaluated: 0 };
        const weather = mean(recent.map(p => p.outside));
        const valid = records.filter(r => { try { validate(r, now); return r.room === room; } catch { return false; } });
        const groups = new Map();
        let evaluated = 0;
        for (const r of valid) {
            const knownContext=v=>typeof v==='string' && v.trim()!=='설비 상태 미입력'?v.trim():'';
            if ((knownContext(context) && knownContext(r.context)!==knownContext(context)) || Math.abs(r.weight / weight - 1) > .2 || Math.abs(r.count / count - 1) > .2) continue;
            // First 30 minutes after the declared start are excluded. Each window is a full six hours.
            for (let start = Math.max(r.start, (r.savedStart ?? r.start) + HOUR / 2); start + 6 * HOUR <= r.end; start += 6 * HOUR) {
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
    const api = { HOUR, DAY, BIN, num, kst, validate, automaticIntervals, bins, recommend };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.VentilationLearning = api;
})(globalThis);
