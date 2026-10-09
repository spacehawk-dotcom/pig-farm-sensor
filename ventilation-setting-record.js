/* Immutable snapshots written together with the shared temperature settings. */
(function(root) {
    const keys = ['f500_1','f500_2','f800_1','f800_2'];
    function build({id, batchId, type, data, updates, context, now, outdoor = []}, V) {
        if (!/^batch_\d+$/.test(batchId)) throw Error('배치 번호를 확인하세요.');
        const count = Number(data.pigs || data.count || data.currentCount || data.totalPigs || 0);
        if (data.status === 'empty' || !Number.isInteger(count) || count <= 0) throw Error('현재 사육 두수가 있는 배치를 선택하세요.');
        const overrides = Object.fromEntries(keys.map(k=>[k,{...(data.ventilationOverrides?.[k] || {})}]));
        for (const [path,value] of Object.entries(updates)) {
            const [,key,field] = path.split('.');
            if (!keys.includes(key) || !['t','min','max','diff'].includes(field) || !Number.isFinite(value)) throw Error('설정값을 확인하세요.');
            overrides[key][field] = value;
        }
        const timing = V.calculatePigAge(data, type), age = timing.age, weight = V.calculateWeight(age);
        if (!Number.isFinite(age) || age < 0 || !Number.isFinite(weight) || weight <= 0) throw Error('일령과 체중을 확인하세요.');
        const opt = V.calculateOptimalSettings(age, weight, count, null, type, timing.stockDiffDays, outdoor, overrides);
        const record = {schemaVersion:1, id, source:'app_saved', room:`${type === '이유사' ? '이유' : '육성'}_${Number(batchId.slice(6))}배치`, batchId,
            createdAt:now, start:now, end:now, groups:keys.map(k=>Object.fromEntries(['t','min','max','diff'].map(f=>[f,opt[k][f]]))),
            count, weight, age, weightSource:'predicted', measuredFlow:null, observation:'unknown',
            context:String(context || '').trim() || '설비 상태 미입력', note:'온도설정 앱에서 저장한 시점의 설정 · 실제 운전 확인 전'};
        if (!valid(record)) throw Error('자동 저장할 설정값을 확인하세요.');
        return record;
    }
    function valid(r) {
        return r?.source === 'app_saved' && typeof r.room === 'string' && Number.isFinite(r.start) && r.start === r.end &&
            Number.isInteger(r.count) && r.count > 0 && Number.isFinite(r.age) && r.age >= 0 && Number.isFinite(r.weight) && r.weight > 0 &&
            typeof r.context === 'string' && r.context.length <= 200 && r.observation === 'unknown' &&
            Array.isArray(r.groups) && r.groups.length === 4 && r.groups.every(g=>g && ['t','min','max','diff'].every(f=>Number.isFinite(g[f])) && g.t>=5 && g.t<=40 && g.min>=0 && g.min<=g.max && g.max<=100 && g.diff>0 && g.diff<=20);
    }
    // Comparison windows are derived at query time; saved snapshots stay immutable.
    function intervals(records, cycle, now) {
        const limit = Math.min(cycle.end ?? now, now);
        const selected = records.filter(r => r.room === cycle.room && Number.isFinite(r.start) && Number.isFinite(r.end) &&
            r.start >= cycle.start && r.start <= limit && r.end >= r.start && (!r.cycleId || r.cycleId === cycle.id) &&
            (r.source === 'app_saved' || r.end <= limit))
            .sort((a,b) => a.start-b.start || String(a.id || '').localeCompare(String(b.id || '')));
        const automatic = selected.filter(r => r.source === 'app_saved');
        const windows = new Map(automatic.map((r,i) => [r, {
            ...r, savedEnd:r.end, end:Math.min(automatic[i+1]?.start ?? limit, limit),
            endExclusive:!!automatic[i+1] || cycle.end != null,
            endBasis:automatic[i+1] ? '다음 설정 저장' : cycle.end != null && cycle.end <= now ? '회차 종료' : '조회 시각'
        }]));
        return selected.map(r => windows.get(r) || {...r, endExclusive:false, endBasis:'관찰 종료'});
    }
    const api={build,valid,intervals};
    if(typeof module === 'object' && module.exports) module.exports=api; else root.VentilationSettingRecord=api;
})(typeof window === 'object' ? window : globalThis);
