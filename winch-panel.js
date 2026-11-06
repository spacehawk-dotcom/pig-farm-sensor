(() => {
  const host = document.getElementById('winch-panel');
  if (!host) return;
  host.innerHTML = `<div class="flex flex-wrap justify-between items-center gap-2"><h2 class="font-bold text-lg">육성사 윈치</h2></div>
    <details class="mt-3"><summary class="cursor-pointer font-bold text-sm">육성사 윈치 설정 · 펼치기/접기</summary>
    <form id="winch-offset-form" class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p class="font-bold text-sm">자동 운전 공통 온도 편차</p><p class="text-xs text-slate-600 mt-1">각 배치의 1그룹 설정온도에 아래 편차를 더합니다. 육성 1~7배치에 공통 적용됩니다.</p>
      ${['up','down'].map(direction=>`<div class="grid grid-cols-3 gap-2 mt-3">${[1,2,3].map(n=>`<label class="text-xs">${direction==='up'?'올림':'내림'} ${n}차 (℃)<input id="winch-offset-${direction}-${n}" type="number" min="${direction==='up'?0.1:-20}" max="${direction==='up'?20:-0.1}" step="0.1" required disabled placeholder="${direction==='up'?'+편차':'−편차'}" class="block w-full border rounded p-2 mt-1 disabled:opacity-50"></label>`).join('')}</div>`).join('')}
      <p class="text-xs text-slate-500 mt-2">올림은 양수, 내림은 음수로 입력하세요. 1차→2차→3차 순서로 편차의 크기를 늘립니다.</p>
      <div class="flex gap-2 mt-3"><button id="winch-offset-save" disabled class="bg-green-700 text-white rounded px-4 py-2 text-sm disabled:opacity-40">편차 저장</button><button id="winch-offset-load" type="button" disabled class="border rounded px-3 py-2 text-sm disabled:opacity-40">저장값 불러오기</button></div>
      <p id="winch-offset-status" role="status" class="text-sm mt-2">편차를 입력하고 저장하세요.</p>
    </form></details>
    <p id="winch-status" role="status" class="text-sm text-slate-700 mt-3">등록된 윈치 정보를 불러오는 중…</p>
    <button id="winch-refresh" hidden class="text-sm underline mt-2">전체 상태 새로고침</button>
    <button id="winch-diagnose" hidden class="text-sm underline mt-2 ml-3">등록된 윈치 연결 진단</button><p id="winch-diagnostic" role="status" class="text-sm text-red-700 mt-2 whitespace-pre-line break-words"></p>
    <p class="text-xs text-slate-500 mt-2">올림·내림 버튼은 해당 배치에 신호를 한 번 보냅니다. 화면을 닫아도 설정한 자동 운전은 계속됩니다.</p>
    <dialog id="winch-auto-dialog" aria-labelledby="winch-auto-title" class="rounded-2xl p-5 w-[min(94vw,480px)] max-h-[90vh] overflow-y-auto shadow-xl backdrop:bg-black/50">
      <div class="flex justify-between items-center gap-3"><h3 id="winch-auto-title" class="font-bold text-lg">자동 운전 설정</h3><button id="winch-auto-close" class="border rounded px-3 py-1">닫기</button></div>
      <p id="winch-auto-settings" role="status" class="text-sm mt-3 font-bold"></p>
      <table class="w-full text-sm my-4 text-left"><thead><tr class="border-b"><th class="py-2">온도 기준</th><th>온도</th><th>작동</th></tr></thead><tbody>
        ${[1,2,3].map(n=>`<tr><td class="py-1">올림 ${n}차</td><td id="winch-auto-up${n}">올림 ${n}차 편차</td><td>올림 5초</td></tr>`).join('')}
        ${[1,2,3].map(n=>`<tr><td class="py-1">내림 ${n}차</td><td id="winch-auto-down${n}">내림 ${n}차 편차</td><td>내림 6초</td></tr>`).join('')}</tbody></table>
      <p id="winch-auto-state" role="status" class="bg-slate-50 rounded p-3 text-sm break-words"></p>
      <p id="winch-auto-sensor" class="text-sm mt-2 break-words"></p>
      <div class="flex flex-wrap gap-2 mt-4"><button id="winch-auto-start" disabled class="bg-green-700 text-white rounded px-4 py-2 disabled:opacity-40">자동 시작·재개</button><button id="winch-auto-stop" class="bg-red-600 text-white rounded px-4 py-2 disabled:opacity-40">자동 보류·정지</button><button id="winch-auto-check" class="border rounded px-3 py-2 disabled:opacity-40">상태 확인</button></div>
    </dialog>`;
  const $ = id => document.getElementById('winch-' + id);
  let controlsReady = false, epoch = 0, refreshId = 0, timer;
  const STATUS_POLL_MS=60000, ERROR_POLL_MS=300000;
  let pollDelay=STATUS_POLL_MS, refreshingEpoch=null;
  const batches = new Map();
  let autoBatch = null, autoBusy = false, autoReady = false, autoView = 0;
  let offsetBusy=false,offsetRevision=null;
  const offsetInputs=()=>['up','down'].flatMap(direction=>[1,2,3].map(n=>$(`offset-${direction}-${n}`)));
  function offsetButtons(){
    offsetInputs().forEach(input=>input.disabled=!controlsReady||offsetBusy);
    $('offset-save').disabled=!controlsReady||offsetBusy||offsetRevision===null;
    $('offset-load').disabled=!controlsReady||offsetBusy;
  }
  function showOffsets(data){
    if(!Number.isSafeInteger(data.revision))throw Error('저장된 편차 정보를 확인하지 못했습니다.');
    offsetRevision=data.revision;
    for(const direction of ['up','down'])for(let n=1;n<=3;n++)$(`offset-${direction}-${n}`).value=data.offsets?.[direction]?.[n-1]??'';
    $('offset-status').textContent=data.configured?'저장된 편차를 불러왔습니다.':'예시 편차를 표시했습니다. 확인 후 저장하면 적용됩니다.';
  }
  async function loadOffsets(){
    if(!controlsReady||offsetBusy)return;
    const ticket=epoch;offsetBusy=true;offsetButtons();
    try{const data=await api('offsets_get');if(ticket===epoch)showOffsets(data);}
    catch(error){if(ticket===epoch){offsetRevision=null;$('offset-status').textContent=error.message;}}
    finally{if(ticket===epoch){offsetBusy=false;offsetButtons();}}
  }
  async function saveOffsets(event){
    event.preventDefault();if(!controlsReady||offsetBusy||offsetRevision===null)return;
    if(offsetInputs().some(input=>input.value.trim()===''||!input.checkValidity())){
      $('offset-status').textContent='올림·내림 편차 6개를 범위에 맞게 입력하세요.';return;
    }
    const offsets=Object.fromEntries(['up','down'].map(direction=>[direction,[1,2,3].map(n=>Number($(`offset-${direction}-${n}`).value))]));
    const ticket=epoch;offsetBusy=true;offsetButtons();
    try{const data=await api('offsets_save',null,{offsets,revision:offsetRevision});
      if(ticket!==epoch)return;showOffsets(data);$('offset-status').textContent='저장 완료 · 자동 운전 중인 배치는 다음 서버 확인부터 적용됩니다.';
      if(autoBatch)await checkAuto();
    }catch(error){if(ticket===epoch){$('offset-status').textContent=error.message;}}
    finally{if(ticket===epoch){offsetBusy=false;offsetButtons();}}
  }
  const status = text => { $('status').textContent = text; };
  function connectionStatus(){
    const failed=[...batches.values()].filter(batch=>!batch.state||batch.state.error||batch.state.autoError).length;
    pollDelay=failed?ERROR_POLL_MS:STATUS_POLL_MS;
    status(`${controlsReady?'제어 연결됨':'연결 중'} · 등록된 윈치 ${batches.size}개`);
  }
  const canMove = batch => controlsReady && batch?.enabled && !batch.busy;
  function showNote(element, text) {
    element.textContent = text;
    element.hidden = !text;
  }
  function historyText(history) {
    if(!Array.isArray(history) || !history.length)return '신호 기록 없음';
    return history.slice(0,20).map(event=>{
      const direction={up:'올림 5초',down:'내림 6초',stop:'정지'}[event.action];
      if(!direction || !Number.isFinite(event.at))return '';
      const at=new Date(event.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
      const temperature=Number.isFinite(event.temperature)?` · ${event.temperature}℃`:'';
      return `${at}\n${event.mode==='auto'?'자동':'수동'} ${direction}${temperature} · ${event.status==='sent'?'신호 요청':'요청 등록'}`;
    }).filter(Boolean).join('\n\n');
  }
  function render() {
    document.querySelectorAll('[data-winch-batch]').forEach(panel => {
      const id = panel.dataset.winchBatch, batch = batches.get(id);
      const note = batch ? batch.message : controlsReady ? '윈치 미등록 · 연결 예정' : '';
      showNote(panel.querySelector('[data-winch-message]'), note);
      panel.querySelectorAll('[data-winch-action]').forEach(button => {
        const action = button.dataset.winchAction;
        button.disabled = action === 'stop' ? !controlsReady || !batch : !canMove(batch);
        const seconds = batch?.[action + 'Seconds'];
        button.textContent = action === 'stop' ? '■ 정지' : `${action === 'up' ? '▲ 올림' : '▼ 내림'}${seconds ? ' ' + seconds + '초' : ''}`;
        button.onclick = event => { event.stopPropagation(); operate(id, action); };
      });
      const autoButton=panel.querySelector('[data-winch-auto]');
      if(autoButton){
        autoButton.disabled=!controlsReady||!batch||batch.busy;
        autoButton.textContent=batch?.state?.auto?.enabled?(batch.state.auto.paused?'자동 보류':'자동 운전 중'):'자동 설정';
        autoButton.onclick=event=>{event.stopPropagation();openAuto(id);};
      }
      const history=panel.querySelector('[data-winch-history]');
      if(history)history.textContent=historyText(batch?.state?.signalHistory);
    });
  }
  function cardHtml(id) {
    if (!/^[1-7]$/.test(String(id))) return '';
    return `<div data-winch-batch="${id}" class="w-28 shrink-0 border-l border-slate-100 pl-3" onclick="event.stopPropagation()">
      <div class="flex flex-col gap-2" role="group" aria-label="육성 ${id}배치 윈치">
        <button type="button" data-winch-action="up" aria-label="육성 ${id}배치 윈치 올림" disabled class="bg-blue-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">▲ 올림</button>
        <button type="button" data-winch-action="stop" aria-label="육성 ${id}배치 윈치 정지" disabled class="bg-red-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">■ 정지</button>
        <button type="button" data-winch-action="down" aria-label="육성 ${id}배치 윈치 내림" disabled class="bg-blue-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">▼ 내림</button>
      </div><p data-winch-message role="status" hidden class="text-[10px] leading-snug text-slate-500 mt-2 break-keep"></p>
      <button type="button" data-winch-auto disabled aria-label="육성 ${id}배치 자동 설정" class="mt-2 w-full border border-green-600 text-green-800 rounded py-1.5 text-xs font-bold disabled:opacity-35">자동 설정</button>
      <div class="mt-2 border-t border-slate-100 pt-2"><p class="text-[10px] font-bold text-slate-600">신호 요청 기록 · 최근 20건</p><div data-winch-history aria-label="육성 ${id}배치 신호 요청 기록" class="max-h-32 overflow-y-auto whitespace-pre-line text-[10px] leading-snug text-slate-500 mt-1">신호 기록 없음</div></div>
      </div>`;
  }
  async function api(action, batchId, extra={}) {
    const response = await fetch('/.netlify/functions/winch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(batchId ? { batchId } : {}), ...extra }), cache: 'no-store', signal: AbortSignal.timeout(35000)
    });
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('Netlify 서버 연결이 필요합니다.');
    const data = await response.json();
    if (!response.ok) throw Object.assign(Error(data.error || '연결 실패'), { status: response.status });
    return data;
  }
  function applyStates(data, versions) {
    if (!data.batches || typeof data.batches !== 'object') throw Error('윈치 목록을 확인하지 못했습니다. 새 배포를 확인하세요.');
    for (const [id, state] of Object.entries(data.batches)) {
      if (!/^[1-7]$/.test(id)) continue;
      const current = batches.get(id);
      if (current && (current.busy || current.version !== versions.get(id))) continue;
      batches.set(id, { ...current, state, enabled:state.enabled ?? current?.enabled, message: '', version: current?.version || 0,
        upSeconds: state.upSeconds, downSeconds: state.downSeconds });
    }
    for (const id of batches.keys()) if (!Object.hasOwn(data.batches, id)) batches.delete(id);
  }
  async function refresh() {
    if (refreshingEpoch===epoch) return;
    const ticket = epoch, requestId = ++refreshId;
    refreshingEpoch=ticket;
    const versions = new Map([...batches].map(([id, batch]) => [id, batch.version]));
    try {
      const data = await api('status_all');
      if (ticket !== epoch || requestId !== refreshId) return;
      applyStates(data, versions);
      const firstConnection=!controlsReady;
      controlsReady=true;
      $('diagnose').hidden=false;
      connectionStatus();
      if(firstConnection)await loadOffsets();
    } catch (error) {
      if (ticket !== epoch || requestId !== refreshId) return;
      pollDelay=ERROR_POLL_MS;
    } finally { if(refreshingEpoch===ticket)refreshingEpoch=null; }
    render();
    if(ticket===epoch)poll();
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!document.hidden) await refresh();
      poll();
    }, pollDelay);
  }
  async function operate(id, action) {
    const batch = batches.get(id);
    if (!controlsReady || !batch || (action !== 'stop' && !canMove(batch))) return;
    if (action !== 'stop' && !window.confirm(`육성 ${id}배치 윈치를 ${batch[action + 'Seconds']}초 ${action === 'up' ? '올림' : '내림'} 신호를 보낼까요? 실제 움직임은 현장에서 판단합니다. 자동 운전 중이면 5분 뒤 새 온도부터 다시 감시합니다.`)) return;
    const ticket = epoch, version = ++batch.version;
    batch.busy = true; batch.message = '신호 요청 중…'; render();
    try {
      const result = await api(action, id);
      if (ticket === epoch && version === batch.version) {
        batch.message = result.message;
        if(result.signalHistory)batch.state={...batch.state,signalHistory:result.signalHistory};
      }
    } catch (error) {
      if (ticket !== epoch || version !== batch.version) return;
      batch.message = error.message;
    } finally {
      if (ticket === epoch && version === batch.version) {
        batch.busy = false; render();
        // Polling will recheck relay outputs; never retry a movement command.
        poll();
      }
    }
  }
  function autoSummary(auto){
    return auto.enabled?(auto.paused?'자동 보류':'자동 운전 중'):'자동 설정 대기';
  }
  function closeAuto(){autoView++;autoBatch=null;autoReady=false;autoBusy=false;$('auto-dialog').close();}
  function autoButtons(){
    $('auto-start').disabled=autoBusy||!autoReady;
    $('auto-stop').disabled=autoBusy||!controlsReady||!autoBatch;
    $('auto-check').disabled=autoBusy;
  }
  async function checkAuto(){
    const id=autoBatch,ticket=epoch,view=++autoView;
    if(!controlsReady||!id)return;
    autoBusy=true;autoReady=false;autoButtons();$('auto-sensor').textContent='온도 센서와 자동 운전 상태 확인 중…';
    $('auto-settings').textContent='1그룹 설정온도 확인 중…';
    for(const key of ['up1','up2','up3','down1','down2','down3'])$('auto-'+key).textContent='확인 중…';
    try{
      const data=await api('auto_status',id);
      if(ticket!==epoch||view!==autoView)return;
      $('auto-state').textContent=autoSummary(data.auto);
      $('auto-sensor').textContent=data.sensorError||`${data.sample.source==='ha'?'HA 온도':'자동 운전용 센서'} ${data.sample.temperature}℃ · 센서 수신 ${new Date(data.sample.measuredAt).toLocaleString('ko-KR')}`;
      const settings=data.settings;
      $('auto-settings').textContent=data.settingsError||(!settings?'1그룹 설정온도를 확인하지 못했습니다.':`이 배치의 1그룹 설정온도: ${settings.targetTemperature}℃`);
      for(const direction of ['up','down'])for(let n=1;n<=3;n++)$('auto-'+direction+n).textContent=settings?`${settings[direction][n-1]}℃ ${direction==='up'?'이상':'이하'}`:'설정값 확인 필요';
      autoReady=!data.sensorError&&!data.settingsError&&!!settings&&(!data.auto.enabled||data.auto.paused)&&canMove(batches.get(id));
    }catch(error){
      if(ticket!==epoch||view!==autoView)return;

      $('auto-sensor').textContent=error.message;
      $('auto-settings').textContent='설정온도를 확인하지 못했습니다. 상태 확인을 다시 눌러주세요.';
    }finally{if(ticket===epoch&&view===autoView){autoBusy=false;autoButtons();}}
  }
  async function openAuto(id){
    if(!controlsReady||!batches.has(id))return;
    autoBatch=id;$('auto-title').textContent=`육성 ${id}배치 자동 운전`;
    $('auto-state').textContent='상태 확인 중…';$('auto-dialog').showModal();await checkAuto();
  }
  async function changeAuto(action){
    if(autoBusy||!controlsReady||!autoBatch)return;
    if(action==='auto_on'&&!autoReady)return;
    const id=autoBatch;
    if(action==='auto_on'&&!window.confirm(`육성 ${id}배치의 온도 자동 운전을 시작·재개하시겠습니까? 현재 온도부터 감시하며, 브라우저를 닫아도 5분마다 기준 온도 통과 여부를 확인하여 올림 5초·내림 6초씩 작동합니다.`))return;
    const ticket=epoch,view=++autoView;
    const batch=batches.get(id),version=++batch.version;
    let succeeded=false;
    batch.busy=true;batch.state=null;autoBusy=true;autoReady=false;autoButtons();render();
    try{
      const result=await api(action,id);
      if(ticket!==epoch||view!==autoView)return;
      succeeded=true;
      $('auto-state').textContent=result.message;batch.message=result.message;
    }catch(error){
      if(ticket!==epoch||view!==autoView)return;

      $('auto-state').textContent=error.message+' 상태 확인 후 다시 확인하세요.';
    }finally{
      if(ticket===epoch&&batch.version===version){batch.busy=false;render();await refresh();}
      if(ticket===epoch&&view===autoView){
        if(succeeded)await checkAuto();
        else {autoBusy=false;autoButtons();}
      }
    }
  }
  $('auto-close').onclick=closeAuto;
  $('offset-form').onsubmit=saveOffsets;
  $('offset-load').onclick=loadOffsets;
  $('auto-dialog').oncancel=()=>{autoView++;autoBatch=null;autoReady=false;autoBusy=false;};
  $('auto-check').onclick=checkAuto;
  $('auto-start').onclick=()=>changeAuto('auto_on');
  $('auto-stop').onclick=()=>changeAuto('auto_off');
  $('diagnose').onclick=async()=>{
    if(!controlsReady)return;
    const ticket=epoch;$('diagnose').disabled=true;$('diagnostic').textContent='장치를 작동시키지 않고 서버 연결을 진단합니다…';
    try{
      const lines=await Promise.all([...batches.keys()].map(async id=>{
        try{
          const result=await api('diagnostics',id);
          return `육성 ${id}배치: ${result.message}${result.state.safetyMatches?'':` 설정 확인 필요 ${JSON.stringify(result.state.safetySnapshot)}`}`;
        }catch(error){if(error.status===401)throw error;return `육성 ${id}배치: ${error.message}`;}
      }));
      if(ticket===epoch)$('diagnostic').textContent=lines.join('\n');
    }
    catch(error){if(ticket===epoch){$('diagnostic').textContent=error.message;}}
    finally{if(ticket===epoch)$('diagnose').disabled=false;}
  };
  $('refresh').onclick = refresh;
  window.addEventListener('pagehide', () => { epoch++; clearTimeout(timer); closeAuto(); });
  window.FarmWinch = { cardHtml, render };
  document.dispatchEvent(new Event('winch-ready'));
  $('refresh').hidden=false;
  refresh();
})();
