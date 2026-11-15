/* Read-only KOCA monitor. Credentials never enter this application. */
(()=>{'use strict';
  const C=window.FeederCore,$=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('ko-KR').format(n);
  const names={complete:'목표 달성',partial:'목표 미달',low:'확인 필요',missing:'미수신',empty:'빈 칸',stale:'수신 지연',unset:'목표 미설정',cleaning:'청소·입식 대기'};
  const operationKey='sungam.feeder.operations.v1',config=window.FeederConfig;
  let cleaningDevices=[...config.cleaningDevices];
  try{const saved=JSON.parse(localStorage.getItem(operationKey));if(saved?.version===config.version&&Array.isArray(saved.cleaningDevices)&&saved.cleaningDevices.every(id=>Number.isInteger(id)&&id>=1&&id<=C.TOTAL))cleaningDevices=[...new Set(saved.cleaningDevices)];}catch{}
  const state={mode:new URLSearchParams(location.search).get('view')==='records'?'archive':'live',rows:[],histories:{},archive:null,filter:'all',query:'',sort:'device',connection:'연결 확인 중',busy:false,generation:0,selected:null};
  const time=ms=>new Date(ms).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false,hour:'2-digit',minute:'2-digit'});
  const date=ms=>new Date(ms).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kg=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n/1000)+' kg';
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
  function options(id){return {archive:state.mode==='archive',deviceId:id,cleaningDevices:Date.now()>=Date.parse(config.effectiveFrom)?cleaningDevices:[]};}
  function operatingNote(stats){
    const note=$('operatingNotice');note.hidden=state.mode==='archive'||stats.cleaning===0;
    document.querySelector('[data-filter="cleaning"]').hidden=state.mode==='archive';
    $('cleaningSummary').textContent=`청소·입식 대기 ${stats.cleaning}대 · 운영 대상 ${stats.expected}대`;
    $('cleaningDescription').textContent=stats.cleaningReceived?`청소로 지정한 ${stats.cleaningReceived}대에서 데이터가 들어오고 있습니다. 입식했다면 운영 상태를 변경하세요.`:'전원을 끈 청소 구간은 미수신·수신 지연·급이량 확인 집계에서 제외합니다.';
    note.classList.toggle('needs-review',stats.cleaningReceived>0);
  }
  function render(){
    const stats=C.summary(state.rows,options()),latest=state.rows.length?Math.max(...state.rows.map(r=>r.measuredAt)):null;
    $('liveMode').classList.toggle('active',state.mode==='live');$('archiveMode').classList.toggle('active',state.mode==='archive');
    $('recordDate').textContent=latest?date(latest)+(state.mode==='archive'?' · 저장 기록':' · 최근 기록'):'수신된 데이터 없음';
    $('totalPercent').textContent=stats.target?stats.percent:'—';$('overallBar').style.width=Math.min(stats.percent,100)+'%';
    $('totalAmount').textContent=stats.active?kg(stats.amount):'—';$('totalTarget').textContent=stats.active?kg(stats.target):'—';
    $('coverage').textContent=`모돈 등록 ${stats.active}대 기준`;
    $('completeCount').textContent=stats.complete;$('lowCount').textContent=stats.low;$('receivedCount').textContent=stats.received;
    $('expectedCount').textContent=`/ ${stats.expected}대`;
    $('dataBreakdown').textContent=`미수신 ${stats.missing} · 지연 ${stats.stale} · 빈 칸 ${stats.empty}`;
    operatingNote(stats);
    const banner=$('sourceBanner');banner.className='source-banner';
    if(state.mode==='archive')banner.innerHTML=`<span>▤</span><span><strong>저장 기록을 보고 있습니다.</strong> ${latest?`${date(latest)} ${time(latest)}까지 · ${stats.received}대의 실제 KOCA 로그`:'로그 파일을 가져오면 급이 현황을 확인할 수 있습니다.'} · 실시간 연결 아님</span>`;
    else {banner.classList.add(state.connection.startsWith('연결됨')?'live':'error');banner.textContent=state.connection+(latest?` · 마지막 원본 기록 ${date(latest)} ${time(latest)}`:'');}
    $('connectionStatus').textContent=state.mode==='archive'?'현재 저장 기록 열람 중입니다. 실시간 연결 확인을 누르면 HA 전달 서버를 조회합니다.':state.connection;
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
      if(s==='cleaning')return `<button class="feeder-card cleaning" data-device="${id}" aria-label="${id}번 급이기 청소·입식 대기 상세"><div class="card-top"><span class="device-number">FEEDER ${String(id).padStart(2,'0')}</span><span class="status-pill">청소 중</span></div><div class="cleaning-title">입식 대기</div><p class="cleaning-reason">청소를 위해 전원을 꺼두었습니다.</p><div class="cleaning-state">${r&&C.status(r,{})!=='stale'?'데이터 수신 중 · 운영 복귀 확인':'계획된 전원 차단 · 장애 아님'}</div><div class="card-bottom"><span>통신·급이량 확인 집계 제외</span><span>상세 보기 ↗</span></div></button>`;
      return `<button class="feeder-card ${s}" data-device="${id}" aria-label="${id}번 급이기 ${escape(occupied?r.sowId:names[s])}, ${names[s]} 상세"><div class="card-top"><span class="device-number">FEEDER ${String(id).padStart(2,'0')}</span><span class="status-pill">${names[s]}</span></div><div class="sow-number"><strong>${escape(occupied?r.sowId:r?'빈 칸':'—')}</strong><span>모돈</span></div><div class="card-amount"><span><b>${occupied?fmt(r.amount):'—'}</b><small>${occupied?`/ ${fmt(r.target)} g`:'데이터 없음'}</small></span><span class="percent">${pct===null?'—':pct+'%'}</span></div><div class="progress"><div style="width:${Math.min(pct||0,100)}%"></div></div><div class="card-bottom"><span>${r?`◷ ${time(r.measuredAt)} 기록`:'수신 대기'}</span><span>상세 보기 ↗</span></div></button>`;
    }).join('');
    $('exportButton').disabled=!state.rows.length&&!stats.cleaning;
  }
  function showDetail(id){
    state.selected=id;
    const r=state.rows.find(x=>x.deviceId===id),s=C.status(r,options(id));
    if(s==='cleaning'){
      $('detailContent').innerHTML=`<div class="detail-title"><h2>${String(id).padStart(2,'0')}번 급이기</h2><span>청소·입식 대기</span></div><div class="cleaning-detail"><strong>입식 전 청소 · 전원 꺼짐</strong><p>농장에서 지정한 계획된 정지 상태입니다. 미수신이나 급이량 부족으로 집계하지 않습니다.</p>${r?`<p>마지막 수신 기록: ${date(r.measuredAt)} ${time(r.measuredAt)} · ${fmt(r.amount)} g</p>`:'<p>전원이 꺼져 있어 급이 데이터 수신을 기다리지 않습니다.</p>'}<button id="resumeDevice" class="button primary">입식 완료 · 운영으로 전환</button><p class="help-note">앱의 분류만 변경합니다. 실제 급이기의 전원을 켜거나 작동시키지 않습니다. 이 브라우저에 저장됩니다.</p></div>`;
      $('resumeDevice').onclick=()=>{saveOperations(cleaningDevices.filter(x=>x!==id));showDetail(id);};
      if(!$('detailDialog').open)$('detailDialog').showModal();return;
    }
    const history=(state.histories[id]||[]).filter(x=>!r||C.koreanDay(x.measuredAt)===C.koreanDay(r.measuredAt));
    const changes=history.filter((x,i)=>i===0||x.amount!==history[i-1].amount||x.target!==history[i-1].target||x.sowId!==history[i-1].sowId);
    const max=Math.max(r?.target||0,...history.map(x=>x.amount),1),start=history[0]?.measuredAt||0,end=history.at(-1)?.measuredAt||1;
    const points=history.map(x=>`${28+(x.measuredAt-start)/Math.max(end-start,1)*440},${145-x.amount/max*120}`).join(' ');
    $('detailContent').innerHTML=`<div class="detail-title"><h2>${String(id).padStart(2,'0')}번 급이기</h2><span>${r?.active?`모돈 ${escape(r.sowId)}`:names[s]}</span></div><p class="detail-source">${state.mode==='archive'?'저장 기록':'실시간 수신'} · ${names[s]}${r?` · ${date(r.measuredAt)} ${time(r.measuredAt)}`:''}</p><div class="detail-metrics"><div>급이량<b>${r?.active?fmt(r.amount)+' g':'—'}</b></div><div>목표량<b>${r?.active?fmt(r.target)+' g':'—'}</b></div><div>달성률<b>${r?.active&&r.percent!==null?r.percent+'%':'—'}</b></div></div><h3>시간대별 누적 급이량</h3>${history.length>1?`<svg class="chart" viewBox="0 0 500 170" role="img" aria-label="${id}번 급이기의 기록 기간 누적 급이량 그래프"><path d="M28 25H468 M28 85H468 M28 145H468" stroke="#e3e9da" stroke-dasharray="4 4" fill="none"/><polygon points="28,145 ${points} 468,145" fill="#86a56720"/><polyline points="${points}" stroke="#729252" stroke-width="2.5" fill="none"/><text x="28" y="16" font-size="10" fill="#8a987b">${fmt(max)} g</text></svg><div class="chart-caption"><span>${time(start)}</span><span>${history.length}건의 실제 기록</span><span>${time(end)}</span></div>`:'<p>시간대 기록이 아직 없습니다. 로그 파일을 가져오거나 새로운 데이터를 기다려 주세요.</p>'}<h3>급이량 변경 기록 <small>최근 12건</small></h3><table class="timeline"><thead><tr><th>기록 시각</th><th>모돈 번호</th><th>급이량</th><th>달성률</th></tr></thead><tbody>${changes.slice(-12).reverse().map(x=>`<tr><td>${time(x.measuredAt)}</td><td>${escape(x.sowId)}</td><td>${fmt(x.amount)} g</td><td>${x.percent===null?'—':x.percent+'%'}</td></tr>`).join('')||'<tr><td colspan="4">추가 기록 없음</td></tr>'}</tbody></table><p class="help-note">급이량은 KOCA 로그의 누적값입니다. 모돈의 실제 섭취 여부나 모터 작동 상태를 뜻하지 않습니다.</p>`;
    if(!$('detailDialog').open)$('detailDialog').showModal();
  }
  async function loadArchive(){
    const generation=++state.generation;state.mode='archive';state.rows=[];state.histories={};if(state.filter==='cleaning')state.filter='all';render();
    if(state.archive){state.rows=state.archive.rows;state.histories=state.archive.histories;render();return;}
    try{
      const response=await fetch('/api/feeder-archive',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!response.ok)throw new Error('missing');
      const data=await response.json();if(generation!==state.generation)return;
      const rows=C.merge([],data.rows);const histories={};for(const [id,list] of Object.entries(data.histories||{}))histories[id]=list.map(C.normalize);
      state.archive={rows,histories};state.rows=rows;state.histories=histories;render();
    }catch{if(generation===state.generation)toast('저장 기록을 보려면 로그 가져오기로 파일을 선택하세요.');}
  }
  async function poll(){
    if(state.mode!=='live'||state.busy)return;state.busy=true;const generation=state.generation;
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
  function live(){state.generation++;state.mode='live';state.rows=[];state.histories={};state.connection='연결 확인 중 · HA 전달 서버를 조회하고 있습니다.';render();poll();}
  async function importFiles(files){
    if(!files.length)return;
    const generation=++state.generation;state.mode='archive';let skipped=0,rows=[],histories={};
    for(const file of files){
      const match=file.name.match(/^(\d{8})_(\d{1,2})(?:\.(?:txt|log))?$/i);if(!match||file.size>20*1024*1024){skipped++;continue;}
      const text=new TextDecoder('utf-8').decode(await file.arrayBuffer()),parsed=C.parseLog(text,Number(match[2]));
      if(!parsed.length){skipped++;continue;}
      const id=Number(match[2]);histories[id]=(histories[id]||[]).concat(parsed).sort((a,b)=>a.measuredAt-b.measuredAt);
    }
    if(generation!==state.generation)return;
    for(const list of Object.values(histories))rows.push(list.at(-1));
    if(!rows.length){toast('읽을 수 있는 EATLOG 기록이 없습니다. 날짜_기기번호 파일을 선택하세요.');render();return;}
    const latestDay=C.koreanDay(Math.max(...rows.map(r=>r.measuredAt)));rows=rows.filter(r=>C.koreanDay(r.measuredAt)===latestDay);
    histories=Object.fromEntries(rows.map(r=>[r.deviceId,histories[r.deviceId].filter(x=>C.koreanDay(x.measuredAt)===latestDay)]));
    state.archive={rows,histories};state.rows=rows;state.histories=histories;state.filter='all';state.query='';$('search').value='';
    render();toast(`${rows.length}대의 ${latestDay} 기록을 가져왔습니다.${skipped?` 제외된 파일 ${skipped}개`:''}`);
  }
  function exportCsv(){
    const cell=v=>'"'+String(v).replace(/^[=+@\-]/,"'$&").replace(/"/g,'""')+'"';
    const map=new Map(state.rows.map(r=>[r.deviceId,r]));
    const lines=[['기기번호','모돈번호','목표량(g)','급이량(g)','달성률(%)','원본수신시각(KST)','상태','데이터구분'],...Array.from({length:C.TOTAL},(_,i)=>{const id=i+1,r=map.get(id);return [id,r?.sowId??'',r?.target??'',r?.amount??'',r?.percent??'',r?new Date(r.measuredAt+9*3600000).toISOString().slice(0,19).replace('T',' '):'',names[C.status(r,options(id))],state.mode==='archive'?'저장 기록':'실시간'];})];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`성암농장_급이현황_${C.koreanDay(state.rows[0]?.measuredAt||Date.now())}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;render();}));
  function saveOperations(ids){
    try{localStorage.setItem(operationKey,JSON.stringify({version:config.version,cleaningDevices:ids}));}
    catch{toast('이 브라우저에 상태를 저장하지 못했습니다.');return false;}
    cleaningDevices=ids;render();toast(`운영 대상 ${C.TOTAL-ids.length}대 · 청소·입식 대기 ${ids.length}대로 저장했습니다.`);return true;
  }
  function openOperations(){
    $('operationDevices').innerHTML=Array.from({length:C.TOTAL},(_,i)=>`<label><input type="checkbox" value="${i+1}" ${cleaningDevices.includes(i+1)?'checked':''}>${String(i+1).padStart(2,'0')}번</label>`).join('');
    $('operationDialog').showModal();
  }
  $('operationButton').onclick=openOperations;$('editCleaning').onclick=openOperations;
  $('selectCleaningBlock').onclick=()=>document.querySelectorAll('#operationDevices input').forEach(x=>{x.checked=Number(x.value)<=24;});
  $('clearCleaning').onclick=()=>document.querySelectorAll('#operationDevices input').forEach(x=>{x.checked=false;});
  $('saveOperations').onclick=()=>{const ids=[...document.querySelectorAll('#operationDevices input:checked')].map(x=>Number(x.value));if(saveOperations(ids))$('operationDialog').close();};
  $('feederGrid').addEventListener('click',e=>{const card=e.target.closest('[data-device]');if(card)showDetail(Number(card.dataset.device));});
  $('search').addEventListener('input',e=>{state.query=e.target.value.trim();render();});$('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
  $('clearFilters').onclick=()=>{state.filter='all';state.query='';$('search').value='';render();};
  $('connectionButton').onclick=()=>$('connectionDialog').showModal();$('retryConnection').onclick=()=>{live();};
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
  $('archiveMode').onclick=loadArchive;$('liveMode').onclick=live;
  for(const id of ['importButton','dialogImport'])$(id).onclick=()=>{$('connectionDialog').close();$('logFiles').click();};
  $('logFiles').onchange=e=>{importFiles([...e.target.files]).catch(()=>toast('로그를 읽지 못했습니다. 파일 형식을 확인하세요.'));e.target.value='';};
  $('exportButton').onclick=exportCsv;
  render();if(state.mode==='archive')loadArchive();else poll();setInterval(poll,15000);setInterval(()=>{if(state.mode==='live')render();},30000);
})();
