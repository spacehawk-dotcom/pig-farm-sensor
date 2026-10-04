/* UI and persistence adapter for actual, user-confirmed controller observations. */
export function createVentilationJournal(host, api) {
    const L = window.VentilationLearning;
    const CACHE = 'sungamfarm-controller-observations-v1';
    const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let batch = null, defaults = null, cloud = [], local = [], unsubscribe = null, generation = 0, busy = false, formDirty = false, defaultSignature = '';
    let storageError = '';
    try { local = JSON.parse(localStorage.getItem(CACHE) || '[]'); if (!Array.isArray(local)) throw Error(); }
    catch { local = []; storageError = '기기 저장 기록을 읽지 못했습니다. 브라우저 저장소를 확인하세요.'; }
    host.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 class="font-bold text-lg">📝 실제 설정 기록 · 데이터 기반 추천</h3><span id="vj-room" class="text-sm text-blue-700"></span></div>
      <p class="text-sm text-slate-600 mb-3">컨트롤러에서 직접 확인한 값을 저장하세요. %는 전압 비율입니다. 추천값을 저장하는 것만으로 실제 설정 기록이 되지는 않습니다.</p>
      <div class="grid sm:grid-cols-2 gap-3 text-sm">
        <label>관찰 시작 (한국시간)<input id="vj-start" type="datetime-local" class="block w-full border rounded p-2"></label>
        <label>관찰 종료 / 확인 시각 (한국시간)<input id="vj-end" type="datetime-local" class="block w-full border rounded p-2"></label>
      </div>
      <p class="text-xs text-slate-500 my-2">처음에는 현재 시각으로 기록할 수 있습니다. 다음 확인 때 ‘최근 기록 이어서 입력’을 누르고 그동안 같은 설정이었는지 확인하세요. 분석에는 관찰이 끝난 기간만 사용하며, 기간 중 설정이 바뀌었다면 나누어 저장하세요.</p>
      <div class="overflow-x-auto"><table class="w-full text-sm min-w-[490px]"><thead><tr class="text-left text-slate-500"><th>그룹</th><th>설정온도 ℃</th><th>최소 %</th><th>최대 %</th><th>편차 ℃</th></tr></thead><tbody>${[1,2,3,4].map(i => `<tr><th class="whitespace-nowrap pr-2">${i}그룹</th>${['t','min','max','diff'].map(f => `<td class="p-1"><input id="vj-g${i}-${f}" aria-label="실제 ${i}그룹 ${ {t:'설정온도',min:'최소 출력',max:'최대 출력',diff:'편차'}[f]}" type="number" step="0.1" class="w-full min-w-16 border rounded p-2"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="grid sm:grid-cols-3 gap-3 my-3 text-sm">
        <label>관찰 당시 두수<input id="vj-count" type="number" min="1" step="1" class="block border rounded p-2 w-full"></label>
        <label>평균 체중 kg<input id="vj-weight" type="number" min="0.1" step="0.1" class="block border rounded p-2 w-full"></label>
        <label>체중 출처<select id="vj-weight-source" class="block border rounded p-2 w-full"><option value="predicted">일령 예측</option><option value="measured">실측</option></select></label>
        <label>관찰 당시 일령<input id="vj-age" type="number" min="0" class="block border rounded p-2 w-full"></label>
        <label>전체 배기량 m³/h (선택)<input id="vj-flow" type="number" min="0" placeholder="실측한 경우만" class="block border rounded p-2 w-full"></label>
        <label>관찰 상태<select id="vj-observation" class="block border rounded p-2 w-full"><option value="unknown">미확인</option><option value="normal">기침·몰림 등 이상 관찰 없음</option><option value="cough">기침·몰림 등 이상 관찰</option></select></label>
      </div>
      <label class="block text-sm">입기구·순환·난방 상태 (같은 조건은 같은 이름 사용)<input id="vj-context" maxlength="200" placeholder="예: 입기 3cm / 순환 켬 / 난방 끔" class="block w-full border rounded p-2 mt-1"></label>
      <label class="block text-sm mt-3">메모<input id="vj-note" maxlength="500" class="block w-full border rounded p-2 mt-1" placeholder="설비 변경, 특이사항 등"></label>
      <label class="flex gap-2 text-sm my-3"><input id="vj-confirm" type="checkbox">위 기간 동안 입력한 설정·사육·설비 조건이 유지된 실제 기록임을 확인했습니다.</label>
      <div class="flex flex-wrap gap-2"><button id="vj-save" class="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-bold">실제 기록 누적 저장</button><button id="vj-continue" class="border rounded-lg px-3 py-2 text-sm">최근 기록 이어서 입력</button><button id="vj-defaults" class="border rounded-lg px-3 py-2 text-sm">현재 공유값 입력</button><button id="vj-retry" class="border rounded-lg px-3 py-2 text-sm">미전송 기록 재전송</button><button id="vj-export" class="border rounded-lg px-3 py-2 text-sm">기록 JSON 내보내기</button></div>
      <p id="vj-status" role="status" class="text-sm text-slate-600 mt-3"></p>
      <details class="mt-3"><summary class="cursor-pointer text-sm font-bold">저장 기록 보기 <span id="vj-total"></span></summary><div id="vj-list" class="text-xs max-h-64 overflow-auto mt-2"></div></details>
      <div class="border-t mt-5 pt-4">
        <h4 class="font-bold mb-2">같은 돈방의 과거 결과로 추천받기</h4>
        <p class="text-xs text-slate-500 mb-3">현재 두수·체중은 사육현황을 사용합니다. 위 ‘입기구·순환·난방 상태’를 현재 상태로 입력하고, 원하는 실내 온도 범위를 정하세요.</p>
        <div class="flex flex-wrap items-end gap-3 text-sm"><label>목표 하한 ℃<input id="vj-low" type="number" step="0.5" class="block w-24 border rounded p-2"></label><label>목표 상한 ℃<input id="vj-high" type="number" step="0.5" class="block w-24 border rounded p-2"></label><button id="vj-analyze" class="bg-indigo-600 text-white rounded-lg px-4 py-2 font-bold">최근 1년 기록 분석</button></div>
        <p class="text-xs text-slate-500 mt-2">초기 목표 범위는 현재 계산값을 참고한 입력값입니다. 농장 관리 목표에 맞게 확인하세요.</p>
        <div id="vj-result" role="status" class="mt-3 p-3 bg-indigo-50 rounded-lg text-sm">실제 기록을 저장한 뒤 분석하세요. 추천은 컨트롤러에 자동 전송되지 않습니다.</div>
        <details class="mt-3 text-xs text-slate-500"><summary class="cursor-pointer">추천 기준과 한계</summary><p class="mt-2">같은 돈방·설비 상태, 두수·체중 ±20%, 최근 6시간 평균 외기 ±3℃, 같은 6시간대(한국시간)를 비교합니다. 첫 30분을 제외한 6시간 관찰, 5분 구간 데이터 75% 이상, 30분 초과 결측 없음, 같은 설정의 서로 다른 3일 이상이 필요합니다. 목표 범위 유지율 80% 이상·1시간 하강 2℃ 이하인 설정을 유지율 순으로 제안합니다. 이 기준은 앱의 비교 기준이며 축산 표준이나 건강 보증이 아닙니다. 미확인·이상 관찰·중복 관찰 기간은 추천에서 제외합니다. 습도·공기질·입기 유속의 적정성을 보증하지 않으며, %를 실제 풍량으로 환산하지 않습니다.</p></details>
      </div>`;
    const $ = id => host.querySelector('#vj-' + id);
    const defaultGroups = opt => ['f500_1','f500_2','f800_1','f800_2'].map(k=>opt[k]);
    ['start','end','count','weight','weight-source','age','flow','observation','context','note',...[1,2,3,4].flatMap(i=>['t','min','max','diff'].map(f=>'g'+i+'-'+f))].forEach(id=>$(id).addEventListener('input',()=>{formDirty=true;}));
    const status = text => { $('status').textContent = text; };
    function records() {
        const map = new Map(local.filter(r => r.room === batch?.room).map(r => [r.id, r]));
        cloud.forEach(r => map.set(r.id, r));
        return [...map.values()].sort((a,b) => b.end - a.end);
    }
    function persist() {
        // Merge other tabs' records before writing this tab's local backup.
        const previous = JSON.parse(localStorage.getItem(CACHE) || '[]');
        if (!Array.isArray(previous)) throw Error('기기 저장 형식 오류');
        const merged = new Map(previous.filter(r=>r&&r.id).map(r=>[r.id,r]));
        local.forEach(r=>merged.set(r.id,{...r,synced:!!(r.synced||merged.get(r.id)?.synced)}));
        const next=[...merged.values()];
        localStorage.setItem(CACHE, JSON.stringify(next));
        local=next;
    }
    function showRecords() {
        const rows = records(); $('total').textContent = `(${rows.length}건)`;
        $('list').innerHTML = rows.length ? rows.slice(0, 100).map(r => `<div class="p-2 border-b">${escape(L.kst(r.start).replace('T',' '))} ~ ${escape(L.kst(r.end).replace('T',' '))}<br>${escape(r.groups?.map((g,i)=>`${i+1}그룹 ${g.t}℃ / ${g.min}~${g.max}% / 편차 ${g.diff}℃`).join(' · '))}<br>${escape(r.context)} · ${r.synced ? '클라우드 저장됨' : '이 기기 저장 · 클라우드 미확인'} · ${escape({normal:'이상 관찰 없음',cough:'이상 관찰',unknown:'관찰 미확인'}[r.observation])}</div>`).join('') : '<p>이 배치의 실제 설정 기록이 없습니다.</p>';
    }
    function fillGroups(groups) { groups.forEach((g,i)=>['t','min','max','diff'].forEach(f=>{ $('g'+(i+1)+'-'+f).value=g[f]; })); $('confirm').checked = false; }
    function useDefaults() { fillGroups(['f500_1','f500_2','f800_1','f800_2'].map(k=>defaults[k])); status('현재 공유 설정을 입력했습니다. 실제 컨트롤러와 대조·수정한 뒤 확인하여 저장하세요.'); }
    function setBusy(value) { busy=value; ['save','retry','continue','defaults','analyze'].forEach(id=>{$(id).disabled=value; $(id).classList.toggle('opacity-50',value);}); }
    async function upload(record) {
        await api.save(record);
        const item=local.find(r=>r.id===record.id); if(item) item.synced=true;
        try { persist(); } catch { status('클라우드 저장 완료. 기기 저장소 상태 표시는 갱신하지 못했습니다.'); }
    }
    $('save').onclick=async()=>{
        if(busy || !batch) return;
        const token=generation;
        try {
            if(!$('confirm').checked) throw Error('실제 적용 기간과 설정을 확인한 뒤 확인란을 선택하세요.');
            const record={schemaVersion:1,id:crypto.randomUUID(),room:batch.room,source:'manual_actual',createdAt:Date.now(),
                start:Date.parse($('start').value+':00+09:00'),end:Date.parse($('end').value+':00+09:00'),
                groups:[1,2,3,4].map(i=>Object.fromEntries(['t','min','max','diff'].map(f=>[f,L.num($('g'+i+'-'+f).value)]))),
                count:L.num($('count').value),weight:L.num($('weight').value),age:L.num($('age').value),weightSource:$('weight-source').value,
                measuredFlow:$('flow').value===''?null:L.num($('flow').value),context:$('context').value.trim(),observation:$('observation').value,note:$('note').value,synced:false};
            L.validate(record);
            if(record.measuredFlow!==null && (!Number.isFinite(record.measuredFlow)||record.measuredFlow<0)) throw Error('실측 배기량은 0 이상으로 입력하세요.');
            if(records().some(r=>Math.max(r.start,record.start)<Math.min(r.end,record.end))) throw Error('기존 관찰 기간과 겹칩니다. 시작·종료를 확인하세요.');
            local.push(record);
            try { persist(); } catch { local.pop(); throw Error('기기 저장소에 기록을 보관하지 못했습니다. 저장 공간·브라우저 설정을 확인하세요.'); }
            setBusy(true); status('이 기기에 저장했습니다. 클라우드 전송 중…'); showRecords();
            // Timeout reports pending honestly; the same ID makes retry idempotent.
            await Promise.race([upload(record),new Promise((_,reject)=>setTimeout(()=>reject(Error('응답 시간 초과')),12000))]);
            if(token===generation){status('클라우드에 새 기록으로 저장했습니다. 기존 기록은 유지됩니다.'); $('confirm').checked=false;
            $('result').textContent='새 기록이 추가되었습니다. 분석 버튼을 눌러 결과를 갱신하세요.';}
        } catch(error) { if(token===generation)status(error.message + (local.some(r=>r.room===batch?.room&&!r.synced)?' · 미전송 기록은 이 기기에 보관됩니다. 재전송 또는 JSON 내보내기를 이용하세요.':'')); }
        finally { setBusy(false); showRecords(); }
    };
    $('retry').onclick=async()=>{if(busy)return;setBusy(true);try{const pending=local.filter(r=>r.room===batch.room&&!r.synced);for(const r of pending)await Promise.race([upload(r),new Promise((_,reject)=>setTimeout(()=>reject(Error('응답 시간 초과')),12000))]);status(`재전송 완료: ${pending.length}건`);}catch(e){status('클라우드 전송 실패: '+e.message+' · 기기 기록은 유지됩니다.');}finally{setBusy(false);showRecords();}};
    $('defaults').onclick=useDefaults;
    $('continue').onclick=()=>{const last=records()[0];if(!last){status('먼저 실제 설정을 한 번 기록하세요.');return;}fillGroups(last.groups);$('start').value=L.kst(last.end);$('end').value=L.kst(Date.now());$('context').value=last.context;$('observation').value='unknown';status('지난 확인 시각부터 입력했습니다. 기간 중 설정·두수·체중·설비 변화가 있었다면 나누어 기록하세요.');};
    $('export').onclick=()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,exportedAt:Date.now(),room:batch.room,records:records()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`controller-${batch.room}-${L.kst(Date.now()).slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    ['context','low','high'].forEach(id=>$(id).addEventListener('input',()=>{$('result').textContent='조건이 변경되었습니다. 분석 버튼을 눌러 결과를 갱신하세요.';}));
    $('analyze').onclick=async()=>{
        if(busy||!batch)return;
        const token=generation, selected={...batch};
        const current={...selected,now:Date.now(),low:L.num($('low').value),high:L.num($('high').value),context:$('context').value.trim()};
        if(!current.context||!Number.isFinite(current.low)||!Number.isFinite(current.high)||current.low>=current.high){$('result').textContent='현재 설비 상태와 목표 온도 하한·상한을 확인하세요.';return;}
        const rows=records().filter(r=>r.end>=current.now-365*L.DAY);
        if(!rows.length){$('result').textContent='추천 보류: 이 배치의 실제 설정 기록이 없습니다. 위에서 기록을 먼저 저장하세요.';return;}
        setBusy(true);
        try {
            const samples=await api.loadSamples(selected.room,rows,current.now, text=>{if(token===generation)$('result').textContent=text;},()=>token!==generation);
            if(token!==generation)return;
            const result=L.recommend(rows,samples,current);
            if(!result.candidates.length){$('result').textContent=result.reason+` 비교 가능한 관찰 구간 ${result.evaluated}개.`;return;}
            $('result').innerHTML=`<p class="font-bold text-indigo-900">${escape(selected.room.replace('_',' '))} · 과거 실사용 설정 추천 후보</p><p class="text-xs my-2">목표 ${current.low}~${current.high}℃ · 최근 6시간 평균 외기 ${result.weather.toFixed(1)}℃ · 현재 ${selected.count}두 / 예측 ${selected.weight}kg</p>`+result.candidates.map((c,i)=>`<div class="bg-white border rounded-lg p-3 mt-2"><strong>${i+1}순위 · ${c.days}일 비교</strong><div class="overflow-x-auto"><table class="w-full text-xs mt-2"><thead><tr><th>그룹</th><th>온도</th><th>최소~최대 전압</th><th>편차</th></tr></thead><tbody>${c.groups.map((g,j)=>`<tr><td>${j+1}</td><td>${g.t}℃</td><td>${g.min}~${g.max}%</td><td>${g.diff}℃</td></tr>`).join('')}</tbody></table></div><p class="text-xs mt-2">목표 유지율 ${(c.inRange*100).toFixed(0)}% · 최대 1시간 하강 ${c.drop.toFixed(1)}℃ · 기록 충족률 ${(c.coverage*100).toFixed(0)}%</p></div>`).join('')+'<p class="text-xs mt-2">해당 조건에서 관찰된 후보입니다. 실제 풍량·공기질 적정성이나 다른 날의 효과는 검증되지 않았습니다. 컨트롤러를 자동 변경하지 않습니다.</p>';
        }catch(e){if(token===generation)$('result').textContent='분석 중단: '+e.message+' · 일부 데이터만으로 추천하지 않습니다.';}
        finally{setBusy(false);}
    };
    return { suspend() {
        generation++; batch=null; cloud=[];
        if(unsubscribe)unsubscribe();
        unsubscribe=null;
    }, setBatch(next,opt) {
        defaults=opt;
        const signature=JSON.stringify(defaultGroups(opt));
        if(batch?.room===next.room){batch=next;if(!formDirty && signature!==defaultSignature)fillGroups(defaultGroups(opt));defaultSignature=signature;return;}
        generation++;batch=next;cloud=[];if(unsubscribe)unsubscribe();
        $('room').textContent=next.room.replace('_',' ');$('start').value=L.kst(Date.now());$('end').value=L.kst(Date.now());
        $('count').value=next.count;$('weight').value=next.weight;$('age').value=next.age;$('weight-source').value='predicted';
        $('context').value='';$('note').value='';$('flow').value='';$('observation').value='unknown';
        fillGroups(defaultGroups(opt));formDirty=false;defaultSignature=signature;$('confirm').checked=false;
        $('low').value=opt.f500_1.t;$('high').value=opt.f500_1.t+2;
        $('result').textContent='실제 기록과 현재 설비 조건을 확인한 뒤 분석하세요.';
        status(storageError||'실제 설정을 입력하세요. 클라우드 기록을 확인 중입니다.');showRecords();
        const token=generation;
        unsubscribe=api.subscribe(next.room,(rows,fromCache)=>{if(token!==generation)return;cloud=rows.map(r=>({...r,synced:true}));showRecords();status(`${cloud.length}건 ${fromCache?'캐시 기록 (서버 확인 대기)':'클라우드 기록 확인'} · 미전송 ${local.filter(r=>r.room===batch.room&&!r.synced&&!cloud.some(c=>c.id===r.id)).length}건`);},e=>{if(token!==generation)return;status('클라우드 기록 읽기 실패: '+e.message+' · 이 기기의 기록은 확인·내보내기할 수 있습니다.');});
    } };
}
