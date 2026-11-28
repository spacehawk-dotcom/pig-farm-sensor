/* Read-only KOCA monitor. Credentials never enter this application. */
(()=>{'use strict';
  const C=window.FeederCore,$=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('ko-KR').format(n);
  const names={complete:'목표 달성',partial:'목표 미달',low:'확인 필요',missing:'미수신',empty:'빈 칸',stale:'수신 지연',unset:'목표 미설정'};
  const state={sows:new Map(),sowStatus:'loading',rows:[],sessions:{},filter:'all',query:'',sort:'device',connection:'연결 확인 중',busy:false,generation:0};
  const detail={deviceId:null,session:null,days:[],request:0,controller:null,loaded:false};
  const time=ms=>new Date(ms).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false,hour:'2-digit',minute:'2-digit'});
  const date=ms=>new Date(ms).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'});
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kg=n=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n/1000)+' kg';
  function sowInfo(row,detail=false){
    if(!row?.active)return '';
    const info=window.FeederSows.labels(state.sows,row.sowId,state.sowStatus,detail);
    return `<div class="sow-info"><span>산차 <b>${escape(info.parity)}</b></span><span>예정일 <b>${escape(info.expected)}</b></span><span>분만일 <b>${escape(info.date)}</b></span></div>`;
  }
  function render(){
    const stats=C.summary(state.rows),latest=state.rows.length?Math.max(...state.rows.map(r=>r.measuredAt)):null;
    $('recordDate').textContent=latest?date(latest)+' · 최근 기록':'수신된 데이터 없음';
    $('totalPercent').textContent=stats.target?stats.percent:'—';$('overallBar').style.width=Math.min(stats.percent,100)+'%';
    $('totalAmount').textContent=stats.active?kg(stats.amount):'—';$('totalTarget').textContent=stats.active?kg(stats.target):'—';
    $('coverage').textContent=`모돈 등록 ${stats.active}대 기준`;
    const banner=$('sourceBanner');banner.className='source-banner';
    banner.classList.add(state.connection.startsWith('연결됨')?'live':'error');banner.textContent=state.connection+(latest?` · 마지막 원본 기록 ${date(latest)} ${time(latest)}`:'');
    const sowStatus={loading:'사육 현황 연결 중',ready:'사육 현황 연동',cache:'연결 확인 중 · 저장된 정보 표시',error:'연결 실패 · 새로고침하여 다시 확인'}[state.sowStatus];
    $('sowSourceStatus').textContent='산차·예정일·분만일 · '+sowStatus;
    $('sowSourceStatus').classList.toggle('warning',state.sowStatus==='error'||state.sowStatus==='cache');
    document.querySelectorAll('.filters button').forEach(b=>{b.classList.toggle('active',b.dataset.filter===state.filter);b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter));});
    const map=new Map(state.rows.map(r=>[r.deviceId,r]));
    let cards=Array.from({length:C.TOTAL},(_,i)=>({id:i+1,row:map.get(i+1)}));
    cards=cards.filter(({id,row})=>{
      const s=C.status(row);return (!state.query||String(id).includes(state.query)||(row?.sowId||'').includes(state.query))&&(state.filter==='all'||s===state.filter);
    });
    cards.sort((a,b)=>{
      if(state.sort==='percent')return (a.row?.percent??Infinity)-(b.row?.percent??Infinity)||a.id-b.id;
      if(state.sort==='recent')return (b.row?.measuredAt||0)-(a.row?.measuredAt||0)||a.id-b.id;
      return a.id-b.id;
    });
    $('resultsCount').textContent=`${cards.length}대 표시 · 전체 72대`;
    $('emptyResults').hidden=cards.length>0;
    const focusedDevice=document.activeElement?.closest?.('[data-device]')?.dataset.device;
    $('feederGrid').innerHTML=cards.map(({id,row:r})=>{
      const s=C.status(r),occupied=r?.active,pct=occupied?r.percent:null;
      return `<article class="feeder-card ${s}" data-device="${id}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="${id}번 급이기 ${escape(occupied?r.sowId:names[s])}, ${names[s]}, 입실 이후 급이 기록 보기"><div class="card-top"><span class="device-number batch-${Math.ceil(id/C.BATCH_SIZE)}" title="${Math.ceil(id/C.BATCH_SIZE)}배치">${id}</span><span class="status-pill">${names[s]}</span></div><div class="card-identity"><div class="sow-number"><strong>${escape(occupied?r.sowId:r?'빈 칸':'—')}</strong></div>${sowInfo(r)}</div><div class="card-amount"><span><b>${occupied?fmt(r.amount):'—'}</b><small>${occupied?`/ ${fmt(r.target)} g`:'데이터 없음'}</small></span><span class="percent">${pct===null?'—':pct+'%'}</span></div><div class="progress"><div style="width:${Math.min(pct||0,100)}%"></div></div><div class="card-bottom"><span>${r?`◷ ${time(r.measuredAt)} 기록`:'수신 대기'}</span><span>급이 기록 보기</span></div></article>`;
    }).join('');
    if(focusedDevice&&!$('historyDialog').open)document.querySelector(`[data-device="${focusedDevice}"]`)?.focus({preventScroll:true});
  }
  async function poll(){
    if(state.busy)return;state.busy=true;const generation=state.generation;
    try{
      const response=await fetch('/.netlify/functions/feeders',{signal:AbortSignal.timeout(12000),cache:'no-store'});
      if(!response.ok)throw new Error('서버 연결 준비가 필요합니다.');
      const data=await response.json();if(generation!==state.generation)return;
      if(!Array.isArray(data.rows))throw new Error('서버 응답을 확인할 수 없습니다.');
      const incoming=C.merge([],data.rows);
      state.rows=incoming;
      state.sessions=data.sessions||{};
      updateDetail();
      const fresh=typeof data.receivedAt==='number'&&Date.now()-data.receivedAt<90000;
      state.connection=data.source==='local-mqtt'?(data.connected?(incoming.length?'연결됨 · HA MQTT 실시간 수신 · 15초마다 갱신':'연결됨 · HA MQTT 구독 중 · 다음 급이기 기록을 기다립니다.'):'MQTT 연결 끊김 · 자동 재연결 중 · 마지막 기록을 표시합니다.'):(fresh?'연결됨 · HA 데이터 수신 · 15초마다 갱신':'HA 전달 모듈의 최근 응답이 없습니다. 마지막 기록을 표시합니다.');
      if((data.source==='local-mqtt'?data.connected:fresh)&&incoming.length&&incoming.every(row=>C.status(row,{})==='stale'))state.connection='급이기 기록 수신 지연 · 전달 연결 정상 · 농장 PC 수집 상태를 확인하세요.';
    }catch(error){if(generation===state.generation)state.connection='연결 대기 · HA 전달 모듈과 서버 설정을 확인하세요. '+(state.rows.length?'마지막 수신값을 유지합니다.':'');}
    finally{state.busy=false;if(generation===state.generation){render();}}
  }
  function drawDetail(){
    const session=detail.session,points=window.FeederHistory.dailyPoints(detail.days,session);
    if(!session||!points.length)return;
    const today=C.koreanDay(),start=C.koreanDay(session.startedAt),last=points.at(-1);
    $('historyTitle').textContent=`모돈 ${session.sowId} 급이 기록`;
    $('historyPeriod').textContent=(session.startKind==='entry-observed'?'입실 감지':'기록 시작')+` ${date(session.startedAt)} ${time(session.startedAt)} · 현재까지`;
    $('historySummary').innerHTML=`<div><span>기록 일수</span><strong>${points.length}<small>일</small></strong></div><div><span>${last.day===today?'오늘':'최근 기록일'} 목표량</span><strong>${kg(last.target)}</strong></div><div><span>${last.day===today?'오늘 현재까지':'최근 기록일'} 섭취량</span><strong>${kg(last.amount)}</strong></div>`;
    const chart=window.FeederHistory.chart(points,start,today),e=escape;
    $('historyChart').innerHTML=`<svg viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="${e(session.sowId)} 모돈의 일별 목표 급이량과 섭취량. 정확한 수치는 아래 일별 수치 보기에서 확인할 수 있습니다.">
      ${chart.grid.map(g=>`<line x1="${chart.left}" x2="${chart.width-chart.right}" y1="${g.y}" y2="${g.y}" class="history-gridline"/><text x="${chart.left-10}" y="${g.y+5}" text-anchor="end">${fmt(g.value/1000)}</text>`).join('')}
      ${chart.ticks.map(t=>`<text x="${t.x}" y="${chart.height-22}" text-anchor="middle">${e(t.day.slice(5).replace('-','/'))}</text>`).join('')}
      <path d="${chart.targetPath}" class="history-target-line"/><path d="${chart.amountPath}" class="history-amount-line"/>
      ${chart.dots.map(p=>`<circle cx="${p.x}" cy="${p.targetY}" r="4" class="history-target-dot"><title>${e(p.day)} 목표 ${fmt(p.target)} g</title></circle><circle cx="${p.x}" cy="${p.amountY}" r="4" class="history-amount-dot"><title>${e(p.day)} 섭취량 ${fmt(p.amount)} g${p.day===today?' · 집계 중':''}</title></circle>`).join('')}
      </svg>`;
    const notes=['기록이 없는 날짜는 0으로 채우지 않으며 선을 연결하지 않습니다.'];
    if(session.startKind!=='entry-observed')notes.unshift('기존 입실 모돈은 입실 시점을 확인할 수 없어 보관된 첫 기록부터 표시합니다.');
    else notes.unshift('입실 시점은 모돈 번호의 신규 입력·변경을 처음 수신한 시각입니다.');
    if(points.some(p=>p.counterReset))notes.push('누적량이 감소한 날은 초기화·수정 가능성이 있어 마지막 수신값으로 표시합니다.');
    if(points.some(p=>p.targetChanged))notes.push('목표량이 변경된 날은 마지막 목표량을 표시합니다.');
    $('historyNotice').textContent=notes.join(' ');
    $('historyTable').innerHTML=points.slice().reverse().map(p=>`<tr><th scope="row">${e(p.day)}${p.day===today?' <span>집계 중</span>':''}${p.counterReset?' <span>누적량 감소</span>':''}</th><td>${fmt(p.target)} g</td><td>${fmt(p.amount)} g</td><td>${p.target?Math.floor(p.amount/p.target*100)+'%':'—'}</td><td>${time(p.measuredAt)}</td></tr>`).join('');
    $('historyStatus').textContent=C.status(state.rows.find(r=>r.deviceId===detail.deviceId))==='stale'?'현재 수신 지연 · 마지막으로 보관된 기록입니다.':'현재까지 보관된 일별 기록입니다.';
    $('historyContent').hidden=false;
  }
  function updateDetail(){
    if(!$('historyDialog').open||!detail.loaded)return;
    const row=state.rows.find(r=>r.deviceId===detail.deviceId),session=state.sessions[detail.deviceId];
    if(!row?.active||row.sowId!==detail.session?.sowId||session&&session.id!==detail.session?.id){
      detail.loaded=false;$('historyContent').hidden=true;
      $('historyStatus').textContent='입실 모돈이 변경되었습니다. 다시 불러오면 새 입실 기록을 표시합니다.';$('historyRetry').hidden=false;return;
    }
    // The regular latest-value poll updates the open chart without re-reading all history documents.
    if(session?.id===detail.session?.id){
      detail.days=window.FeederHistory.dailyPoints([...detail.days,{...row,day:C.koreanDay(row.measuredAt)}],detail.session);
      drawDetail();
    }
  }
  async function loadDetail(){
    detail.controller?.abort();const controller=new AbortController();detail.controller=controller;
    const request=++detail.request,id=detail.deviceId,row=state.rows.find(r=>r.deviceId===id);
    detail.loaded=false;detail.session=null;detail.days=[];
    $('historyDevice').textContent=`${Math.ceil(id/C.BATCH_SIZE)}배치 · ${id}번 급이기`;
    $('historyTitle').textContent=row?.active?`모돈 ${row.sowId} 급이 기록`:'입실 모돈 급이 기록';
    $('historyPeriod').textContent='';$('historyContent').hidden=true;$('historyRetry').hidden=true;
    if(!row?.active){$('historyStatus').textContent=row?'현재 입실 모돈이 없는 빈 칸입니다.':'수신된 급이기 기록이 없습니다.';return;}
    $('historyStatus').textContent='입실 이후 일별 기록을 불러오는 중…';
    try{
      let cursor=null,sessionId=null,days=[],session;
      do{
        const params=new URLSearchParams({action:'history',deviceId:String(id),sowId:row.sowId});
        if(cursor)params.set('cursor',cursor);if(sessionId)params.set('sessionId',sessionId);
        const response=await fetch('/.netlify/functions/feeders?'+params,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(response.status===409)throw new Error('입실 모돈이 변경되었습니다. 다시 불러와 주세요.');
        if(!response.ok)throw new Error('급이 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        const data=await response.json();
        if(!Array.isArray(data.days)||!data.session)throw new Error('입실 기록 저장 기능이 아직 준비되지 않았습니다. 서버 배포 상태를 확인해 주세요.');
        if(request!==detail.request||!$('historyDialog').open)return;
        session=data.session;sessionId=session.id;days.push(...data.days);
        if(data.nextCursor&&data.nextCursor===cursor)throw new Error('급이 기록 조회를 완료하지 못했습니다. 다시 시도해 주세요.');
        cursor=data.nextCursor;
      }while(cursor);
      const current=state.rows.find(r=>r.deviceId===id),currentSession=state.sessions[id];
      if(current?.sowId!==session.sowId||currentSession&&currentSession.id!==session.id)throw new Error('입실 모돈이 변경되었습니다. 다시 불러와 주세요.');
      detail.session=session;detail.days=days;detail.loaded=true;drawDetail();updateDetail();
    }catch(error){
      if(request!==detail.request||controller.signal.aborted)return;
      $('historyStatus').textContent=error.name==='TimeoutError'?'응답이 지연되고 있습니다. 다시 불러와 주세요.':error.message;
      $('historyRetry').hidden=false;
    }
  }
  function openDetail(card){
    detail.deviceId=Number(card.dataset.device);
    if(!$('historyDialog').open)$('historyDialog').showModal();
    loadDetail();
  }
  $('feederGrid').addEventListener('click',event=>{const card=event.target.closest('[data-device]');if(card)openDetail(card);});
  $('feederGrid').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){const card=event.target.closest('[data-device]');if(card){event.preventDefault();openDetail(card);}}});
  $('historyClose').onclick=()=>$('historyDialog').close();$('historyRetry').onclick=loadDetail;
  $('historyDialog').addEventListener('close',()=>{
    detail.controller?.abort();detail.request++;detail.loaded=false;
    document.querySelector(`[data-device="${detail.deviceId}"]`)?.focus();
  });
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;render();}));
  $('search').addEventListener('input',e=>{state.query=e.target.value.trim();render();});$('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
  $('clearFilters').onclick=()=>{state.filter='all';state.query='';$('search').value='';render();};
  render();poll();setInterval(poll,15000);setInterval(render,30000);
  window.FeederSows.subscribe(({status,records})=>{
    state.sowStatus=status;if(records)state.sows=records;
    render();
  });
})();
