/* Read-only KOCA monitor. Credentials never enter this application. */
(()=>{'use strict';
  const C=window.FeederCore,$=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('ko-KR').format(n);
  const names={complete:'목표 달성',partial:'목표 미달',low:'확인 필요',missing:'미수신',empty:'빈 칸',stale:'수신 지연',unset:'목표 미설정'};
  const state={sows:new Map(),sowStatus:'loading',rows:[],filter:'all',query:'',sort:'device',connection:'연결 확인 중',busy:false,generation:0};
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
    $('feederGrid').innerHTML=cards.map(({id,row:r})=>{
      const s=C.status(r),occupied=r?.active,pct=occupied?r.percent:null;
      return `<article class="feeder-card ${s}" data-device="${id}" aria-label="${id}번 급이기 ${escape(occupied?r.sowId:names[s])}, ${names[s]}"><div class="card-top"><span class="device-number batch-${Math.ceil(id/C.BATCH_SIZE)}" title="${Math.ceil(id/C.BATCH_SIZE)}배치">${id}</span><span class="status-pill">${names[s]}</span></div><div class="card-identity"><div class="sow-number"><strong>${escape(occupied?r.sowId:r?'빈 칸':'—')}</strong></div>${sowInfo(r)}</div><div class="card-amount"><span><b>${occupied?fmt(r.amount):'—'}</b><small>${occupied?`/ ${fmt(r.target)} g`:'데이터 없음'}</small></span><span class="percent">${pct===null?'—':pct+'%'}</span></div><div class="progress"><div style="width:${Math.min(pct||0,100)}%"></div></div><div class="card-bottom"><span>${r?`◷ ${time(r.measuredAt)} 기록`:'수신 대기'}</span></div></article>`;
    }).join('');
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
      const fresh=typeof data.receivedAt==='number'&&Date.now()-data.receivedAt<90000;
      state.connection=data.source==='local-mqtt'?(data.connected?(incoming.length?'연결됨 · HA MQTT 실시간 수신 · 15초마다 갱신':'연결됨 · HA MQTT 구독 중 · 다음 급이기 기록을 기다립니다.'):'MQTT 연결 끊김 · 자동 재연결 중 · 마지막 기록을 표시합니다.'):(fresh?'연결됨 · HA 데이터 수신 · 15초마다 갱신':'HA 전달 모듈의 최근 응답이 없습니다. 마지막 기록을 표시합니다.');
      if((data.source==='local-mqtt'?data.connected:fresh)&&incoming.length&&incoming.every(row=>C.status(row,{})==='stale'))state.connection='급이기 기록 수신 지연 · 전달 연결 정상 · 농장 PC 수집 상태를 확인하세요.';
    }catch(error){if(generation===state.generation)state.connection='연결 대기 · HA 전달 모듈과 서버 설정을 확인하세요. '+(state.rows.length?'마지막 수신값을 유지합니다.':'');}
    finally{state.busy=false;if(generation===state.generation){render();}}
  }
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;render();}));
  $('search').addEventListener('input',e=>{state.query=e.target.value.trim();render();});$('sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
  $('clearFilters').onclick=()=>{state.filter='all';state.query='';$('search').value='';render();};
  render();poll();setInterval(poll,15000);setInterval(render,30000);
  window.FeederSows.subscribe(({status,records})=>{
    state.sowStatus=status;if(records)state.sows=records;
    render();
  });
})();
