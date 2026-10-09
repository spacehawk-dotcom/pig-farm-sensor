/* Automatic setting history and sensor-based recommendations. */
export function createVentilationJournal(host, api) {
    const L = window.VentilationLearning;
    const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let batch = null, cloud = [], unsubscribe = null, generation = 0, busy = false;
    host.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3"><h3 class="font-bold text-lg">📝 설정 자동 기록 · 데이터 기반 추천</h3><span id="vj-room" class="text-sm text-blue-700"></span></div>
      <div hidden>
      <p class="text-sm text-slate-600 mb-3">온도설정 앱에서 저장한 설정과 당시 두수·일령·체중을 자동으로 불러옵니다. 설정 저장부터 다음 설정 저장까지, 마지막 설정은 조회 시각까지의 센서 온도를 분석합니다. 종료 회차는 회차 종료까지만 비교합니다.</p>
      <button id="vj-export" class="border rounded-lg px-3 py-2 text-sm">자동 기록 JSON 내보내기</button>
      <p id="vj-status" role="status" class="text-sm text-slate-600 mt-3"></p>
      <details class="mt-3"><summary class="cursor-pointer text-sm font-bold">저장 기록 보기 <span id="vj-total"></span></summary><div id="vj-list" class="text-xs max-h-64 overflow-auto mt-2"></div></details>
      </div>
      <div>
        <h4 class="font-bold mb-2">같은 돈방의 과거 결과로 추천받기</h4>
        <p class="text-xs text-slate-500 mb-3">현재 두수·체중은 사육현황을 사용합니다. 설비 상태가 입력되어 있으면 같은 상태의 기록을 비교하며, 미입력 시에는 설비 조건을 구분하지 않습니다. 원하는 실내 온도 범위를 정하세요.</p>
        <div class="flex flex-wrap items-end gap-3 text-sm"><label>목표 하한 ℃<input id="vj-low" type="number" step="0.5" class="block w-24 border rounded p-2"></label><label>목표 상한 ℃<input id="vj-high" type="number" step="0.5" class="block w-24 border rounded p-2"></label><button id="vj-analyze" class="bg-indigo-600 text-white rounded-lg px-4 py-2 font-bold">최근 1년 기록 분석</button></div>
        <p class="text-xs text-slate-500 mt-2">초기 목표 범위는 현재 계산값을 참고한 입력값입니다. 농장 관리 목표에 맞게 확인하세요.</p>
        <div id="vj-result" role="status" class="mt-3 p-3 bg-indigo-50 rounded-lg text-sm">온도설정 앱의 자동 저장 기록으로 분석합니다. 추천은 컨트롤러에 자동 전송되지 않습니다.</div>
        <details class="mt-3 text-xs text-slate-500"><summary class="cursor-pointer">추천 기준과 한계</summary><p class="mt-2">같은 돈방(설비 상태 입력 시 같은 상태), 두수·체중 ±20%, 최근 6시간 평균 외기 ±3℃, 같은 6시간대(한국시간)를 비교합니다. 첫 30분을 제외한 6시간 관찰, 5분 구간 데이터 75% 이상, 30분 초과 결측 없음, 같은 설정의 서로 다른 3일 이상이 필요합니다. 목표 범위 유지율 80% 이상·1시간 하강 2℃ 이하인 설정을 유지율 순으로 제안합니다. 이 기준은 앱의 비교 기준이며 축산 표준이나 건강 보증이 아닙니다. 수동 관찰 기록은 제외합니다. 자동 저장값이 다음 저장까지 유지되었다고 가정하며 실제 장비 작동이나 동물의 건강 상태를 확인한 기록은 아닙니다. 습도·공기질·입기 유속의 적정성을 보증하지 않으며, %를 실제 풍량으로 환산하지 않습니다.</p></details>
      </div>`;
    const $ = id => host.querySelector('#vj-' + id);
    const status = text => { $('status').textContent = text; };
    const records = () => cloud.filter(r => r.source === 'app_saved' && r.room === batch?.room).sort((a,b)=>b.start-a.start);
    function showRecords() {
        const rows=records(); $('total').textContent=`(${rows.length}건)`;
        $('list').innerHTML=rows.length?rows.slice(0,100).map(r=>`<div class="p-2 border-b"><strong>앱 설정 자동 저장</strong> · ${escape(L.kst(r.start).replace('T',' '))}<br>${escape(r.groups.map((g,i)=>`${i+1}그룹 ${g.t}℃ / ${g.min}~${g.max}% / 편차 ${g.diff}℃`).join(' · '))}<br>${escape(r.count)}두 / ${escape(r.age)}일령 / ${escape(r.weight)}kg${r.weightSource==='predicted'?' (예측)':''}</div>`).join(''):'<p>이 돈방의 자동 저장 기록이 없습니다.</p>';
    }
    function setBusy(value) { busy=value; $('analyze').disabled=value; }
    $('export').onclick=()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,exportedAt:Date.now(),room:batch.room,records:records()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`controller-${batch.room}-${L.kst(Date.now()).slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    ['low','high'].forEach(id=>$(id).addEventListener('input',()=>{$('result').textContent='조건이 변경되었습니다. 분석 버튼을 눌러 결과를 갱신하세요.';}));
    $('analyze').onclick=async()=>{
        if(busy||!batch)return;
        const token=generation, selected={...batch};
        const current={...selected,now:Date.now(),low:L.num($('low').value),high:L.num($('high').value),context:batch.context || ''};
        if(!Number.isFinite(current.low)||!Number.isFinite(current.high)||current.low>=current.high){$('result').textContent='목표 온도 하한·상한을 입력하고, 하한이 상한보다 낮은지 확인하세요.';return;}
        setBusy(true);
        try {
            const cycles=await api.loadCycles(selected.room);
            if(token!==generation)return;
            if(Number.isFinite(selected.cycleStart) && !cycles.some(c=>c.start===selected.cycleStart)) cycles.push({room:selected.room,start:selected.cycleStart,end:null});
            const rows=L.automaticIntervals(records(),cycles,current.now,window.VentilationSettingRecord);
            if(!rows.length){$('result').textContent='추천 보류: 입식 회차와 연결되는 최근 1년 자동 저장 기록이 없습니다. 입식 회차별 기록에서 회차 정보를 확인하세요.';return;}
            const samples=await api.loadSamples(selected.room,rows,current.now, text=>{if(token===generation)$('result').textContent=text;},()=>token!==generation,cycles);
            if(token!==generation)return;
            const result=L.recommend(rows,samples,current);
            if(!result.candidates.length){$('result').textContent=result.reason+` 비교 가능한 온도 구간 ${result.evaluated}개.`;return;}
            $('result').innerHTML=`<p class="font-bold text-indigo-900">${escape(selected.room.replace('_',' '))} · 자동 저장 설정 추천 후보</p><p class="text-xs my-2">목표 ${current.low}~${current.high}℃ · 최근 6시간 평균 외기 ${result.weather.toFixed(1)}℃ · 현재 ${selected.count}두 / 예측 ${selected.weight}kg</p>`+result.candidates.map((c,i)=>`<div class="bg-white border rounded-lg p-3 mt-2"><strong>${i+1}순위 · ${c.days}일 비교</strong><div class="overflow-x-auto"><table class="w-full text-xs mt-2"><thead><tr><th>그룹</th><th>온도</th><th>최소~최대 전압</th><th>편차</th></tr></thead><tbody>${c.groups.map((g,j)=>`<tr><td>${j+1}</td><td>${g.t}℃</td><td>${g.min}~${g.max}%</td><td>${g.diff}℃</td></tr>`).join('')}</tbody></table></div><p class="text-xs mt-2">목표 유지율 ${(c.inRange*100).toFixed(0)}% · 최대 1시간 하강 ${c.drop.toFixed(1)}℃ · 기록 충족률 ${(c.coverage*100).toFixed(0)}%</p></div>`).join('')+'<p class="text-xs mt-2">해당 조건에서 관찰된 후보입니다. 실제 풍량·공기질 적정성이나 다른 날의 효과는 검증되지 않았습니다. 컨트롤러를 자동 변경하지 않습니다.</p>';
        }catch(e){if(token===generation)$('result').textContent='분석 중단: '+e.message+' · 일부 데이터만으로 추천하지 않습니다.';}
        finally{setBusy(false);}
    };
    return { suspend() {
        generation++; batch=null; cloud=[];
        if(unsubscribe)unsubscribe();
        unsubscribe=null;
    }, setBatch(next,opt) {
        if(batch?.room===next.room && batch?.cycleStart===next.cycleStart){batch=next;return;}
        generation++;batch=next;cloud=[];if(unsubscribe)unsubscribe();
        $('room').textContent=next.room.replace('_',' ');
        $('low').value=opt.f500_1.t;$('high').value=opt.f500_1.t+2;
        $('result').textContent='자동 저장 기록과 목표 온도 범위를 확인한 뒤 분석하세요.';
        status('온도설정 앱의 자동 저장 기록을 불러오는 중입니다.');showRecords();
        const token=generation;
        unsubscribe=api.subscribe(next.room,(rows,fromCache)=>{if(token!==generation)return;cloud=rows.filter(r=>r.source==='app_saved');showRecords();status(`${cloud.length}건 ${fromCache?'캐시 기록 (서버 확인 대기)':'자동 저장 기록 확인'}`);},e=>{if(token!==generation)return;cloud=[];showRecords();status('자동 저장 기록 읽기 실패: '+e.message);});
    } };
}
