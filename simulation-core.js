/* Pure calculations shared by the browser and regression checks. */
(function (root) {
    'use strict';
    const CFM_TO_CMH = 1.69901082;
    const FAN500 = 6960;
    const FAN800 = Math.round(10574 * CFM_TO_CMH);
    const CAPS = [FAN500 * 2, FAN500 * 3, FAN800 * 2, FAN800 * 2];
    const DAY = 86400000;
    const MAX_RANGE_DAYS = 31;
    function toKoreanInput(time) {
        return new Date(time + 9 * 3600000).toISOString().slice(0, 16);
    }
    function parseKoreanInput(value) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return NaN;
        const time = Date.parse(value + ':00+09:00');
        return Number.isFinite(time) && toKoreanInput(time) === value ? time : NaN;
    }
    function validateRange(start, end, now = Date.now()) {
        if (![start, end].every(Number.isFinite)) throw new Error('시작·종료 일시를 모두 입력하세요.');
        if (start >= end) throw new Error('종료 일시는 시작 일시보다 늦어야 합니다.');
        if (end > now) throw new Error('종료 일시는 현재 시각 이후로 설정할 수 없습니다.');
        if (end - start > MAX_RANGE_DAYS * DAY) throw new Error('한 번에 최대 31일까지 조회할 수 있습니다. 기간을 나누어 선택하세요.');
        return { start, end };
    }
    function presetRange(hours = 24, now = Date.now()) {
        const end = Math.floor(now / 60000) * 60000;
        return validateRange(end - hours * 3600000, end, now);
    }
    function number(value) {
        if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    function validateSettings(s) {
        for (let i = 1; i <= 4; i++) {
            const g = s['g' + i];
            if (!g || ![g.t, g.p, g.min, g.max].every(Number.isFinite)) throw new Error(i + '그룹의 모든 설정값을 입력하세요.');
            if (!Number.isInteger(g.t) || !Number.isInteger(g.p) || g.p < 1) throw new Error(i + '그룹 온도와 편차는 1℃ 단위이며 편차는 1 이상이어야 합니다.');
            if (g.min < 0 || g.max > 100 || g.min > g.max) throw new Error(i + '그룹 출력은 0~100%이며 최소 ≤ 최대여야 합니다.');
        }
        return s;
    }
    function rate(temp, g) {
        const steps = Math.max(0, Math.floor(temp - g.t));
        return g.min + Math.min(1, steps / g.p) * (g.max - g.min);
    }
    function rates(temp, s) {
        return Object.fromEntries([1, 2, 3, 4].map(i => ['v' + i, rate(temp, s['g' + i])]));
    }
    function flow(v) { return CAPS.reduce((sum, cap, i) => sum + cap * v['v' + (i + 1)] / 100, 0); }
    function normalize(raw, sensor, range = { start: Date.now() - DAY, end: Date.now() }) {
        // Retain the original timestamp-only API for existing callers/tests.
        if (typeof range === 'number') range = { start: range - DAY, end: range };
        const unique = new Map();
        for (const row of raw) {
            const time = number(row.time), inside = number(row.data?.[sensor]?.temp), outside = number(row.data?.['외부온도']?.temp);
            if (time === null || time < range.start || time > range.end || inside === null || inside < -50 || inside > 70) continue;
            unique.set(time, { time, inTemp: inside, outTemp: outside !== null && outside >= -50 && outside <= 70 ? outside : null });
        }
        return [...unique.values()].sort((a, b) => a.time - b.time);
    }
    function hourDrops(points) {
        let maxDrop = 0, pairs = 0, cursor = 0;
        for (let i = 1; i < points.length; i++) {
            const target = points[i].time - 3600000;
            while (cursor + 1 < i && points[cursor + 1].time <= target) cursor++;
            let j = cursor;
            if (j + 1 < i && Math.abs(points[j + 1].time - target) < Math.abs(points[j].time - target)) j++;
            if (Math.abs(points[j].time - target) > 600000) continue;
            // Do not interpret a long outage as a continuous temperature event.
            let gap = false;
            for (let k = j + 1; k <= i; k++) if (points[k].time - points[k - 1].time > 1800000) gap = true;
            if (gap) continue;
            pairs++;
            maxDrop = Math.max(maxDrop, points[j].inTemp - points[i].inTemp);
        }
        return { maxDrop, pairs };
    }
    function estimatedWeight(age) {
        if (!Number.isFinite(age) || age <= 0 || age > 180) return null;
        const w = age <= 21 ? 5 + age / 21 * 2 : age <= 70 ? 7 + (age - 21) / 49 * 23 : 30 + (age - 70) / 110 * 85;
        return Math.round(w * 10) / 10;
    }
    // NIAS, '돈사 설계시 고려해야할 환기홴 선정 방법', tables 1 and 2.
    // At shared boundaries use the heavier class; upper endpoint of final class is inclusive.
    function requirements(weight, count, source = 'nias') {
        if (!Number.isFinite(weight) || !Number.isInteger(count) || count < 1) return null;
        const nias = [[5.5, 13.5, 3.5, 43], [13.5, 34, 5, 60], [34, 68, 12, 130], [68, 100, 17, 205]];
        const mwps = [[5.4, 13.6, 2, 25], [13.6, 34, 3, 35], [34, 68, 7, 75], [68, 99.8, 10, 120]];
        const rows = source === 'mwps' ? mwps : nias;
        const row = rows.find((r, i) => weight >= r[0] && (weight < r[1] || i === rows.length - 1 && weight === r[1]));
        if (!row) return null;
        const factor = source === 'mwps' ? CFM_TO_CMH : 1;
        return { min: row[2] * factor * count, max: row[3] * factor * count, perMin: row[2] * factor, perMax: row[3] * factor, range: row[0] + '–' + row[1] + 'kg' };
    }
    root.VentCore = { CFM_TO_CMH, FAN500, FAN800, CAPS, DAY, MAX_RANGE_DAYS, toKoreanInput, parseKoreanInput, validateRange, presetRange, number, validateSettings, rate, rates, flow, normalize, hourDrops, estimatedWeight, requirements };
    if (typeof module !== 'undefined') module.exports = root.VentCore;
})(typeof globalThis !== 'undefined' ? globalThis : window);
