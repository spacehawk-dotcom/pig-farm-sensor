/* Read-only KOCA monitor. Credentials never enter this application. */
(()=>{'use strict';
  const C=window.FeederCore,$=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('ko-KR').format(n);
  const names={complete:'목표 달성',partial:'목표 미달',low:'확인 필요',missing:'미수신',empty:'빈 칸',stale:'수신 지연',unset:'목표 미설정',cleaning:'청소·입식 대기'};
  const operationKey='sungam.feeder.operations.v1',config=window.FeederConfig;
  let cleaningDevices=[...config.cleaningDevices];
  try{const saved=JSON.parse(localStorage.getItem(operationKey));if(saved?.version===config.version&&Array.isArray(saved.cleaningDevices)&&saved.cleaningDevices.every(id=>Number.isInteger(id)&&id>=1&&id<=C.TOTAL))cleaningDevices=[...new Set(saved.cleaningDevices)];}catch{}
  const state={sows:new Map(),sowStatus:'loading',rows:[],histories:{},filter:'all',query:'',sort:'device',connection:'연결 확인 중',busy:false,generation:0,selected:null};
  const time=ms=>new Date(ms).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false,hour:'2-digit',minute:'2-digit'});
  const date=ms=>new Date(ms).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kg=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n/1000)+' kg';
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
  function options(id){return {deviceId:id,cleaningDevices:Date.now()>=Date.parse(config.effectiveFrom)?cleaningDevices:[]};}
  function operatingNote(stats){
    const note=$('operatingNotice');note.hidden=stats.cleaning===0;
    const waiting=C.batches(cleaningDevices).filter(b=>b.cleaningCount>0).map(b=>b.label).join('·');
    $('cleaningSummary').textContent=`${waiting} 청소·입식 대기 ${stats.cleaning}대 · 운영 대상 ${stats.expected}대`;
    $('cleaningDescription').textContent=stats.cleaningReceived?`청소로 지정한 ${stats.cleaningReceived}대에서 데이터가 들어오고 있습니다. 입식했다면 운영 상태를 변경하세요.`:'전원을 끈 청소 구간은 미수신·수신 지연·급이량 확인 집계에서 제외합니다.';
    note.classList.toggle('needs-review',stats.cleaningReceived>0);
  }
  function sowInfo(row,detail=false){
    if(!row?.active)return '';
    const info=window.FeederSows.labels(state.sows,row.sowId,state.sowStatus,detail);
    return `<div class="sow-info"><span>산차 <b>${escape(info.parity)}</b></span><span>예정일 <b>${escape(info.expected)}</b></span><span>분만일 <b>${escape(info.date)}</b></span></div>`;
  }
  function render(){
    const stats=C.summary(state.rows,options()),latest=state.rows.length?Math.max(...state.rows.map(r=>r.measuredAt)):null;
    $('recordDate').textContent=latest?date(latest)+' · 최근 기록':'수신된 데이터 없음';
    $('totalPercent').textContent=stats.target?stats.percent:'—';$('overallBar').style.width=Math.min(stats.percent,100)+'%';
    $('totalAmount').textContent=stats.active?kg(stats.amount):'—';$('totalTarget').textContent=stats.active?kg(stats.target):'—';
    $('coverage').textContent=`모돈 등록 ${stats.active}대 기준`;
    operatingNote(stats);
    const banner=$('sourceBanner');banner.className='source-banner';
    banner.classList.add(state.connection.startsWith('연결됨')?'live':'error');banner.textContent=state.connection+(latest?` · 마지막 원본 기록 ${date(latest)} ${time(latest)}`:'');
    const sowStatus={loading:'사육 현황 연결 중',ready:'사육 현황 연동',cache:'연결 확인 중 · 저장된 정보 표시',error:'연결 실패 · 새로고침하여 다시 확인'}[state.sowStatus];
    $('sowSourceStatus').textContent='산차·예정일·분만일 · '+sowStatus;
    $('sowSourceStatus').classList.toggle('warning',state.sowStatus==='error'||state.sowStatus==='cache');
    $('connectionStatus').textContent=state.connection+' / 산차·예정일·분만일: '+sowStatus;
    document.querySelectorAll('.filters button').forEach(b=>{b.classList.toggle('active',b.dataset.filter===state.filter);b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter));});
    const map=new Map(state.rows.map(r=>[r.deviceId,r]));
    let cards=Array.from({length:C.TOTAL},(_,i)=>({id:i+1,row:map.get(i+1)}));
    cards=cards.filter(({id,row})=>{
      const s=C.status(row,options(id));return (!state.query||String(id).includes(state.query)||(row?.sowId||'').includes(state.query))&&(state.filter==='all'||s===state.filter);
    });
    cards.sort((a,b)=>{
      const ac=C.status(a.row,options(a.id))==='cleaning',bc=C.status(b.row,options(b.id))==='cleaning';
      if(ac!==bc)return ac?1:-1;
      if(!a.row!==!b.row)return a.row?-1:1;
      if(state.sort==='percent')return (a.row?.percent??Infinity)-(b.row?.percent??Infinity)||a.id-b.id;
      if(state.sort==='recent')return (b.row?.measuredAt||0)-(a.row?.measuredAt||0)||a.id-b.id;
      return a.id-b.id;
    });
    $('resultsCount').textContent=`${cards.length}대 표시 · 운영 중인 기기 우선`;
    $('emptyResults').hidden=cards.length>0;
    $('feederGrid').innerHTML=cards.map(({id,row:r})=>{
      const s=C.status(r,options(id)),occupied=r?.active,pct=occupied?r.percent:null;
      if(s==='cleaning')return `<button class="feeder-card cleaning" data-device="${id}" aria-label="${id}번 급이기 청소·입식 대기 상세"><div class="card-top"><span class="device-number batch-${Math.ceil(id/C.BATCH_SIZE)}" title="${Math.ceil(id/C.BATCH_SIZE)}배치">${id}</span><span class="status-pill">청소 중</span></div><div class="cleaning-title">입식 대기</div><p class="cleaning-reason">청소를 위해 전원을 꺼두었습니다.</p><div class="cleaning-state">${r&&C.status(r,{})!=='stale'?'데이터 수신 중 · 운영 복귀 확인':'계획된 전원 차단 · 장애 아님'}</div><div class="card-bottom"><span>통신·급이량 확인 집계 제외</span><span>상세 보기 ↗</span></div></button>`;
      return `<button class="feeder-card ${s}" data-device="${id}" aria-label="${id}번 급이기 ${escape(occupied?r.sowId:names[s])}, ${names[s]} 상세"><div class="card-top"><span class="device-number batch-${Math.ceil(id/C.BATCH_SIZE)}" title="${Math.ceil(id/C.BATCH_SIZE)}배치">${id}</span><span class="status-pill">${names[s]}</span></div><div class="card-identity"><div class="sow-number"><strong>${escape(occupied?r.sowId:r?'빈 칸':'—')}</strong></div>${sowInfo(r)}</div><div class="card-amount"><span><b>${occupied?fmt(r.amount):'—'}</b><small>${occupied?`/ ${fmt(r.target)} g`:'데이터 없음'}</small></span><span class="percent">${pct===null?'—':pct+'%'}</span></div><div class="progress"><div style="width:${Math.min(pct||0,100)}%"></div></div><div class="card-bottom"><span>${r?`◷ ${time(r.measuredAt)} 기록`:'수신 대기'}</span><span>상세 보기 ↗</span></div></button>`;
    }).join('');
  }
  function showDetail(id){
    state.selected=id;
    const r=state.rows.find(x=>x.deviceId===id),s=C.status(r,options(id));
    if(s==='cleaning'){
      const batch=C.batches(cleaningDevices).find(b=>b.devices.includes(id));
      $('detailContent').innerHTML=`<div class="detail-title"><h2>${String(id).padStart(2,'0')}번 급이기</h2><span>${batch.label} · 청소·입식 대기</span></div><div class="cleaning-detail"><strong>${batch.label} 입식 전 청소 · 전원 꺼짐</strong><p>${batch.start}~${batch.end}번, 24대를 함께 관리합니다. 청소 중에는 미수신이나 급이량 부족으로 집계하지 않습니다.</p>${r?`<p>마지막 수신 기록: ${date(r.measuredAt)} ${time(r.measuredAt)} · ${fmt(r.amount)} g</p>`:'<p>전원이 꺼져 있어 급이 데이터 수신을 기다리지 않습니다.</p>'}<button id="resumeDevice" class="button primary">${batch.label} 입식 완료 · 24대 운영으로 전환</button><p class="help-note">해당 배치 24대의 앱 분류를 함께 변경합니다. 실제 전원이나 급이기를 제어하지 않습니다. 이 브라우저에 저장됩니다.</p></div>`;
      $('resumeDevice').onclick=()=>{saveOperations(cleaningDevices.filter(x=>!batch.devices.includes(x)));showDetail(id);};
      if(!$('detailDialog').open)$('detailDialog').showModal();return;
    }
    const history=C.chartHistory(state.histories[id]||[],r);
    const changes=history.filter((x,i)=>i===0||x.amount!==history[i-1].amount||x.target!==history[i-1].target||x.sowId!==history[i-1].sowId);
    $('detailContent').innerHTML=`<div class="detail-title"><h2>${String(id).padStart(2,'0')}번 급이기</h2><span>${r?.active?`모돈 ${escape(r.sowId)}`:names[s]}</span></div><p class="detail-source">실시간 수신 · ${names[s]}${r?` · ${date(r.measuredAt)} ${time(r.measuredAt)}`:''}</p>${sowInfo(r,true)}<div class="detail-metrics"><div>누적 급이량<b>${r?.active?fmt(r.amount)+' g':'—'}</b></div><div>하루 목표량<b>${r?.active?fmt(r.target)+' g':'—'}</b></div><div>하루 달성률<b>${r?.active&&r.percent!==null?r.percent+'%':'—'}</b></div></div>${feedingChart(r,history)}<h3>급이량 변경 기록 <small>최근 12건</small></h3><table class="timeline"><thead><tr><th>기록 시각</th><th>모돈 번호</th><th>누적 급이량</th><th>달성률</th></tr></thead><tbody>${changes.slice(-12).reverse().map(x=>`<tr><td>${time(x.measuredAt)}</td><td>${escape(x.sowId)}</td><td>${fmt(x.amount)} g</td><td>${x.percent===null?'—':x.percent+'%'}</td></tr>`).join('')||'<tr><td colspan="4">추가 기록 없음</td></tr>'}</tbody></table><p class="help-note">급이량은 KOCA 로그의 누적값입니다. 모돈의 실제 섭취 여부나 모터 작동 상태를 뜻하지 않습니다.</p>`;
    if(!$('detailDialog').open)$('detailDialog').showModal();
  }
  function feedingChart(row,history){
    if(!row?.active)return '<h3>하루 3회 급이 계획</h3><p>07:00 · 11:30 · 17:00에 각각 1/3씩 급이합니다. 모돈과 하루 목표량이 등록되면 그래프가 표시됩니다.</p>';
    const plan=C.feedingPlan(row.target,row.measuredAt),dayStart=Date.parse(C.koreanDay(row.measuredAt)+'T00:00:00+09:00');
    const max=Math.max(row.target,...history.map(x=>x.amount),1),x=minute=>52+minute/1440*424,y=amount=>180-amount/max*144;
    const at=ms=>x((ms-dayStart)/60000),amount=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(n);
    let planned=`M52 ${y(0)}`,actual='';
    plan.forEach(slot=>{planned+=` H${x(slot.minute)} V${y(slot.cumulative)}`;});planned+=' H476';
    history.forEach((r,i)=>{const previous=history[i-1],gap=!previous||r.measuredAt-previous.measuredAt>C.STALE_MS||r.amount<previous.amount;actual+=gap?` M${at(r.measuredAt)} ${y(r.amount)}`:` H${at(r.measuredAt)} V${y(r.amount)}`;});
    return `<h3>하루 3회 급이 · 시간대별 누적량</h3><div class="feeding-rounds">${plan.map(slot=>`<div><span>${slot.round}차 · ${slot.label} 시작</span><strong>${row.target?amount(slot.amount)+' g':'목표 미설정'}</strong><small>하루 목표의 1/3</small></div>`).join('')}</div><div class="chart-key"><span><i class="actual-key"></i>실제 누적 급이량</span><span><i class="plan-key"></i>누적 배정량 (1/3 → 2/3 → 전체)</span></div><svg class="chart feeding-chart" viewBox="0 0 500 226" role="img" aria-label="${row.deviceId}번 급이기, 하루 목표 ${fmt(row.target)}그램. 07시, 11시 30분, 17시 각각 3분의 1 배정 계획과 실제 누적 급이량"><text x="8" y="16" class="axis-label">누적량 (g)</text>${[0,1/3,2/3,1].map(ratio=>`<path d="M52 ${y(max*ratio)}H476" class="chart-grid"/><text x="45" y="${y(max*ratio)+4}" text-anchor="end" class="axis-label">${amount(max*ratio)}</text>`).join('')}${plan.map(slot=>`<path d="M${x(slot.minute)} 26V180" class="meal-marker"/><text x="${x(slot.minute)}" y="20" text-anchor="middle" class="meal-label">${slot.round}차</text>`).join('')}${row.target?`<path d="${planned}" class="planned-line"/>`:''}<path d="${actual}" class="actual-line"/>${history.map(r=>`<circle cx="${at(r.measuredAt)}" cy="${y(r.amount)}" r="2" fill="#477958"><title>${time(r.measuredAt)} · ${fmt(r.amount)} g</title></circle>`).join('')}${[{minute:0,label:'00:00'},...C.FEEDING_TIMES,{minute:1440,label:'24:00'}].map(slot=>`<text x="${x(slot.minute)}" y="205" text-anchor="middle" class="axis-label">${slot.label}</text>`).join('')}</svg><div class="chart-caption"><span>${date(row.measuredAt)} · 한국 시간</span><span>실제 기록 ${history.length}건</span></div>${history.length<2?'<p class="schedule-note">현재 실제 기록 1건을 점으로 표시했습니다. 다음 기록부터 변화가 표시됩니다.</p>':''}${history.some((r,i)=>i&&r.target!==history[i-1].target)?'<p class="schedule-note">하루 목표량이 변경된 기록이 있습니다. 배정 계획은 마지막 기록의 목표량 기준입니다.</p>':''}`;
  }
  async function poll(){
    if(state.busy)return;state.busy=true;const generation=state.generation;
    try{
      const response=await fetch('/.netlify/functions/feeders',{signal:AbortSignal.timeout(12000),cache:'no-store'});
      if(!response.ok)throw new Error('서버 연결 준비가 필요합니다.');
      const data=await response.json();if(generation!==state.generation)return;
      if(!Array.isArray(data.rows))throw new Error('서버 응답을 확인할 수 없습니다.');
      const incoming=C.merge([],data.rows);
      if(data.source==='local-mqtt'&&data.histories){for(const [id,list] of Object.entries(data.histories)){if(Array.isArray(list))state.histories[id]=list.map(C.normalize).slice(-500);}}
      for(const row of incoming){const list=state.histories[row.deviceId]||[];if(!list.length||row.measuredAt>list.at(-1).measuredAt)list.push(row);state.histories[row.deviceId]=list.slice(-500);}
      state.rows=incoming;
      const fresh=typeof data.receivedAt==='number'&&Date.now()-data.receivedAt<90000;
      state.connection=data.source==='local-mqtt'?(data.connected?(incoming.length?'연결됨 · HA MQTT 실시간 수신 · 15초마다 갱신':'연결됨 · HA MQTT 구독 중 · 다음 급이기 기록을 기다립니다.'):'MQTT 연결 끊김 · 자동 재연결 중 · 마지막 기록을 표시합니다.'):(fresh?'연결됨 · HA 데이터 수신 · 15초마다 갱신':'HA 전달 모듈의 최근 응답이 없습니다. 마지막 기록을 표시합니다.');
      if(data.source==='local-mqtt'&&data.connected&&incoming.length&&incoming.every(row=>C.status(row,{})==='stale'))state.connection='급이기 기록 수신 지연 · MQTT 연결 정상 · 마지막 기록을 표시합니다.';
    }catch(error){if(generation===state.generation)state.connection='연결 대기 · HA 전달 모듈과 서버 설정을 확인하세요. '+(state.rows.length?'마지막 수신값을 유지합니다.':'');}
    finally{state.busy=false;if(generation===state.generation){render();if($('detailDialog').open&&state.selected)showDetail(state.selected);}}
  }
  function live(){state.generation++;state.rows=[];state.histories={};state.connection='연결 확인 중 · HA 전달 서버를 조회하고 있습니다.';render();poll();}
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;render();}));
  function saveOperations(ids){
    try{localStorage.setItem(operationKey,JSON.stringify({version:config.version,cleaningDevices:ids}));}
    catch{toast('이 브라우저에 상태를 저장하지 못했습니다.');return false;}
    cleaningDevices=ids;render();toast(`운영 대상 ${C.TOTAL-ids.length}대 · 청소·입식 대기 ${ids.length}대로 저장했습니다.`);return true;
  }
  function openOperations(){
    $('operationDevices').innerHTML=C.batches(cleaningDevices).map(batch=>`<article class="batch-card ${batch.state}"><div class="batch-header"><span class="batch-number">${batch.id}</span><div><h3>${batch.label}</h3><p>급이기 ${batch.start}~${batch.end}번 · 24대</p></div><span class="batch-badge">${batch.state==='cleaning'?'청소·입식 대기':batch.state==='operating'?'운영 중':'개별 설정 혼합'}</span></div><label for="batchState${batch.id}">${batch.label} 운영 상태</label><select id="batchState${batch.id}" data-batch="${batch.id}">${batch.state==='mixed'?'<option value="mixed" selected disabled>24대에 적용할 상태를 선택하세요</option>':''}<option value="operating" ${batch.state==='operating'?'selected':''}>운영 중</option><option value="cleaning" ${batch.state==='cleaning'?'selected':''}>청소·입식 대기</option></select><p class="batch-help">${batch.state==='cleaning'?'24대 모두 통신·급이량 확인 집계에서 제외합니다.':batch.state==='mixed'?'기존 개별 설정을 배치 단위로 통일해 주세요.':'24대 모두 데이터 수신과 급이량을 확인합니다.'}</p></article>`).join('');
    $('batchSaveError').hidden=true;
    $('operationDialog').showModal();
  }
  $('operationButton').onclick=openOperations;$('editCleaning').onclick=openOperations;
  $('operationDevices').onchange=e=>{
    const select=e.target.closest('[data-batch]');if(!select)return;
    const card=select.closest('.batch-card'),cleaning=select.value==='cleaning';
    card.className=`batch-card ${select.value}`;
    card.querySelector('.batch-badge').textContent=cleaning?'청소·입식 대기':'운영 중';
    card.querySelector('.batch-help').textContent=cleaning?'저장하면 24대 모두 통신·급이량 확인 집계에서 제외합니다.':'저장하면 24대 모두 데이터 수신과 급이량을 확인합니다.';
    $('batchSaveError').hidden=true;
  };
  $('saveOperations').onclick=()=>{
    const selects=[...document.querySelectorAll('#operationDevices [data-batch]')];
    if(selects.some(x=>!['operating','cleaning'].includes(x.value))){$('batchSaveError').hidden=false;return;}
    const ids=C.cleaningFromBatches(selects.filter(x=>x.value==='cleaning').map(x=>Number(x.dataset.batch)));
    if(saveOperations(ids))$('operationDialog').close();
  };
  $('feederGrid').addEventListener('click',e=>{const card=e.target.closest('[data-device]');if(card)showDetail(Number(card.dataset.device));});
  $('search').addEventListener('input',e=>{state.query=e.target.value.trim();render();});$('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
  $('clearFilters').onclick=()=>{state.filter='all';state.query='';$('search').value='';render();};
  $('connectionButton').onclick=()=>$('connectionDialog').showModal();$('retryConnection').onclick=()=>{live();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  render();poll();setInterval(poll,15000);setInterval(render,30000);
  window.FeederSows.subscribe(({status,records})=>{
    state.sowStatus=status;if(records)state.sows=records;
    render();if($('detailDialog').open&&state.selected)showDetail(state.selected);
  });
})();
