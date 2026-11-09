(function(root) {
    const keys = ['f500_1','f500_2','f800_1','f800_2'];
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function create(id, settings, now = Date.now()) {
        if (!keys.every(key => settings?.[key] && ['t','min','max','diff'].every(field => Number.isFinite(settings[key][field]))))
            throw Error('저장할 환기 설정을 확인하세요.');
        return {id, createdAt:now, date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now), settings:JSON.parse(JSON.stringify(settings))};
    }
    function legacyRecord(saved) {
        return {...saved, id:'legacy', legacy:true, createdAt:Date.parse(saved.date+'T00:00:00+09:00') || 0};
    }
    async function save(database, batchRef, settings, now = Date.now()) {
        const history = batchRef.collection('ventilation_setting_history');
        const recordRef = history.doc();
        const record = create(recordRef.id, settings, now);
        await database.runTransaction(async tx => {
            const snapshot = await tx.get(batchRef);
            if (!snapshot.exists) throw Error('배치를 찾지 못했습니다.');
            const previous = snapshot.data().savedVentSettings;
            // Preserve the one snapshot available before the log feature, exactly once.
            if (previous?.settings && !previous.id) tx.set(history.doc('legacy'), legacyRecord(previous));
            tx.set(recordRef, record);
            tx.update(batchRef, {savedVentSettings:record});
        });
        return record;
    }
    function renderRecord(record, open = false) {
        const stamp = record.legacy || !Number.isFinite(record.createdAt)
            ? `${record.date || '날짜 미상'} (기존 기록 · 시각 없음)`
            : new Date(record.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
        const colors = ['text-blue-700','text-teal-700','text-orange-700','text-rose-700'];
        return `<details class="rounded-lg border border-slate-200 bg-white p-2.5" ${open?'open':''}><summary class="cursor-pointer text-xs font-bold text-slate-700">${escape(stamp)}</summary><div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">${keys.map((key,i)=>{
            const group = record.settings?.[key] || {};
            const number = field => Number.isFinite(group[field]) ? group[field] : '--';
            const minimum = i < 2 ? `<strong class="text-xs font-extrabold ${colors[i]}">${number('min')}</strong>` : number('min');
            const range = i===1 && group.min===0 ? '최소환기 OFF' : i===3 ? `최대 ${number('max')}%` : `${minimum}~${number('max')}%`;
            return `<div class="rounded bg-slate-50 p-2 text-center"><div class="flex items-center justify-between gap-1 mb-1"><p class="text-[10px] text-slate-500 whitespace-nowrap">${i+1}그룹</p><p class="text-sm font-bold whitespace-nowrap ${colors[i]}">${number('t')}℃</p></div><p class="text-[10px] text-slate-600">편차 ${number('diff')}℃ · ${range}</p></div>`;
        }).join('')}</div></details>`;
    }
    function mount(container, batchRef, latest, localRecords) {
        container.innerHTML = '<div class="flex justify-between items-center mb-2"><h4 class="text-xs font-bold text-slate-700">고정된 설정 기록 · 저장 로그</h4><span data-count class="text-[10px] text-slate-500"></span></div><div data-list class="space-y-2 max-h-80 overflow-y-auto"></div><p data-status class="text-xs text-slate-500 mt-2" role="status"></p><button type="button" data-more hidden class="w-full mt-2 border rounded-lg py-2 text-xs font-bold">이전 기록 더 보기</button>';
        const list=container.querySelector('[data-list]'), status=container.querySelector('[data-status]'), more=container.querySelector('[data-more]');
        let cursor=null, count=0, loading=false;
        const show = records => {
            for(const record of records) list.insertAdjacentHTML('beforeend',renderRecord(record,count++===0));
            container.querySelector('[data-count]').textContent=`최근순 · ${count}건 표시`;
        };
        async function load() {
            if(loading)return;
            loading=true;more.disabled=true;status.textContent='저장 기록 불러오는 중…';
            try {
                if(!batchRef) {
                    show(localRecords?.length ? [...localRecords].reverse() : latest?.settings ? [legacyRecord(latest)] : []);
                    more.hidden=true;
                } else {
                    let query=batchRef.collection('ventilation_setting_history').orderBy('createdAt','desc').limit(20);
                    if(cursor)query=query.startAfter(cursor);
                    const snapshot=await query.get();
                    if(!container.isConnected)return;
                    show(snapshot.docs.map(doc=>doc.data()));
                    if(!cursor && snapshot.empty && latest?.settings)show([latest.id?latest:legacyRecord(latest)]);
                    cursor=snapshot.docs.at(-1)||cursor;
                    more.hidden=snapshot.size<20;
                }
                status.textContent=count?'':'저장된 환기 설정이 없습니다.';
                more.textContent='이전 기록 더 보기';
            } catch(error) {
                status.textContent='저장 기록을 불러오지 못했습니다. 다시 시도하세요.';
                more.hidden=false;more.textContent='다시 불러오기';
            } finally {loading=false;more.disabled=false;}
        }
        more.onclick=load;
        return load();
    }
    const api={create,legacyRecord,save,renderRecord,mount};
    if(typeof module==='object'&&module.exports)module.exports=api; else root.VentilationSaveHistory=api;
})(typeof window==='object'?window:globalThis);
