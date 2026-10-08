(function(root) {
    'use strict';
    function count(value) {
        if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
        const n = Number(value);
        return Number.isInteger(n) && n >= 0 ? n : null;
    }
    function date(value) {
        const m = typeof value === 'string' && value.trim().match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/);
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
        return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2]-1 && d.getUTCDate() === +m[3] ? d.toISOString().slice(0,10) : null;
    }
    function record(r) {
        const full = date(r.date);
        const short = typeof r.date === 'string' && r.date.trim().match(/^(\d{1,2})[/.\-](\d{1,2})$/);
        const shortValid = short && date(`2000-${short[1]}-${short[2]}`) && Number(r.parity) > 0;
        const primary = Object.prototype.hasOwnProperty.call(r, 'total') ? r.total : r.totalBorn;
        const conflict = count(r.total) !== null && count(r.totalBorn) !== null && count(r.total) !== count(r.totalBorn);
        return {...r, full, day:full || (shortValid ? `${Number(short[1])}/${Number(short[2])} (연도 미기록)` : null), litter:conflict ? null : count(primary), conflict};
    }
    function analyze(sows, mode, today, includeZero = false) {
        const rows = [], unknown = [];
        for (const sow of sows) {
            if (!sow || !sow.sowNo || sow.isActive === false || ['도태','폐사','매각','출하'].includes(sow.currentStatus)) continue;
            if (!(Number(sow.parity) >= 1 || (Number(sow.parity) === 0 && sow.currentStatus === '임신'))) continue;
            const history = (Array.isArray(sow.history) ? sow.history : []).filter(Boolean).map(record)
                .filter(r => r.day && (!r.full || r.full <= today)).sort((a,b) => Number(b.parity || 0)-Number(a.parity || 0) || b.day.localeCompare(a.day));
            const chosen = mode === 'all' ? history : history.slice(0, mode === 'three' ? 3 : 1);
            const reason = !chosen.length ? '분만 기록 없음' : mode === 'three' && chosen.length < 3 ? '최근 3회 기록 부족' : chosen.some(r => r.conflict) ? '앱 간 산자수 불일치' : chosen.some(r => r.litter === null) ? '산자수 미입력' : !includeZero && chosen.some(r => r.litter === 0) ? '0두 기록 확인 필요' : '';
            const row = {sow, history, chosen, reason, value:reason ? null : chosen.reduce((sum,r) => sum+r.litter,0)/chosen.length};
            (reason ? unknown : rows).push(row);
        }
        rows.sort((a,b) => a.value-b.value || String(a.sow.sowNo).localeCompare(String(b.sow.sowNo), 'ko', {numeric:true}));
        return {rows, unknown};
    }
    const api = {analyze};
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SowProductivity = api;
})(typeof window === 'object' ? window : globalThis);
