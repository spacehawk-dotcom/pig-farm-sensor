(() => {
  const host = document.getElementById('winch-panel');
  if (!host) return;
  host.innerHTML = `<div class="flex flex-wrap justify-between items-center gap-2"><h2 class="font-bold text-lg">육성사 윈치</h2><button id="winch-lock" class="text-sm underline">잠금</button></div>
    <form id="winch-offset-form" class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p class="font-bold text-sm">자동 운전 공통 온도 편차</p><p class="text-xs text-slate-600 mt-1">각 배치의 1그룹 설정온도에 아래 편차를 더합니다. 육성 1~7배치에 공통 적용됩니다.</p>
      ${['up','down'].map(direction=>`<div class="grid grid-cols-3 gap-2 mt-3">${[1,2,3].map(n=>`<label class="text-xs">${direction==='up'?'올림':'내림'} ${n}차 (℃)<input id="winch-offset-${direction}-${n}" type="number" min="${direction==='up'?0.1:-20}" max="${direction==='up'?20:-0.1}" step="0.1" required disabled placeholder="${direction==='up'?'+편차':'−편차'}" class="block w-full border rounded p-2 mt-1 disabled:opacity-50"></label>`).join('')}</div>`).join('')}
      <p class="text-xs text-slate-500 mt-2">올림은 양수, 내림은 음수로 입력하세요. 1차→2차→3차 순서로 편차의 크기를 늘립니다.</p>
      <div class="flex gap-2 mt-3"><button id="winch-offset-save" disabled class="bg-green-700 text-white rounded px-4 py-2 text-sm disabled:opacity-40">편차 저장</button><button id="winch-offset-load" type="button" disabled class="border rounded px-3 py-2 text-sm disabled:opacity-40">저장값 불러오기</button></div>
      <p id="winch-offset-status" role="status" class="text-sm mt-2">제어 비밀번호로 연결한 후 편차를 입력하고 저장하세요.</p>
    </form>
    <form id="winch-login" class="flex flex-wrap gap-2 mt-3"><label class="text-sm">제어 비밀번호 <input id="winch-password" type="password" autocomplete="off" required class="border rounded p-2 max-w-full" placeholder="관리자에게 받은 비밀번호"></label><button id="winch-connect" class="bg-slate-700 text-white rounded px-4 py-2 disabled:opacity-40">연결 확인</button></form>
    <p id="winch-status" role="status" class="text-sm text-slate-700 mt-3">상단에서 한 번 연결하면 등록된 육성 배치의 윈치를 사용할 수 있습니다.</p>
    <button id="winch-refresh" hidden class="text-sm underline mt-2">전체 상태 새로고침</button>
    <button id="winch-diagnose" hidden class="text-sm underline mt-2 ml-3">등록된 윈치 연결 진단</button><p id="winch-diagnostic" role="status" class="text-sm text-red-700 mt-2 whitespace-pre-line break-words"></p>
    <p class="text-xs text-slate-500 mt-2">장치의 자동 꺼짐 설정을 사용합니다. 표시 상태는 릴레이 출력이며 실제 윈치 위치가 아닙니다. 화면 잠금·브라우저 종료 후에도 설정한 자동 운전은 계속됩니다.</p>
    <dialog id="winch-auto-dialog" aria-labelledby="winch-auto-title" class="rounded-2xl p-5 w-[min(94vw,480px)] max-h-[90vh] overflow-y-auto shadow-xl backdrop:bg-black/50">
      <div class="flex justify-between items-center gap-3"><h3 id="winch-auto-title" class="font-bold text-lg">자동 운전 설정</h3><button id="winch-auto-close" class="border rounded px-3 py-1">닫기</button></div>
      <p class="text-sm text-slate-600 mt-3">서버에서 <b>5분마다</b> 확인합니다. 한 번 확인할 때 한 단계만 작동하며, 같은 단계에서는 반복하지 않습니다.</p>
      <p id="winch-auto-settings" role="status" class="text-sm mt-3 font-bold"></p>
      <table class="w-full text-sm my-4 text-left"><thead><tr class="border-b"><th class="py-2">단계 이동</th><th>온도</th><th>작동</th></tr></thead><tbody>
        ${[1,2,3].map(n=>`<tr><td class="py-1">${n-1} → ${n}</td><td id="winch-auto-up${n}">올림 ${n}차 편차</td><td>올림 5초</td></tr>`).join('')}
        ${[1,2,3].map(n=>`<tr><td class="py-1">${4-n} → ${3-n}</td><td id="winch-auto-down${n}">내림 ${n}차 편차</td><td>내림 6초</td></tr>`).join('')}</tbody></table>
      <p class="text-xs text-slate-500">온도앱에서 저장한 1그룹 설정온도를 5분마다 다시 읽습니다. 변경값은 다음 서버 확인부터 적용됩니다.</p>
      <p id="winch-auto-state" role="status" class="bg-slate-50 rounded p-3 text-sm break-words"></p>
      <p id="winch-auto-sensor" class="text-sm mt-2 break-words"></p>
      <label class="block mt-4 text-sm font-bold">현장에서 확인한 현재 단계
        <select id="winch-auto-stage" class="block w-full border rounded p-2 mt-2"><option value="">선택하세요</option><option value="0">0단계 · 세 단계 내림 기준 상태</option><option value="1">1단계 · 기준에서 1회 올림</option><option value="2">2단계 · 기준에서 2회 올림</option><option value="3">3단계 · 기준에서 3회 올림</option></select>
      </label>
      <p class="text-xs text-slate-500 mt-2">단계는 실제 위치 측정값이 아닙니다. 최초 전환·정지·다른 앱 조작 후에는 현재 단계를 확인하고 재개하세요. 센서 갱신이 15분 이상 지연되면 대기합니다.</p>
      <div class="flex flex-wrap gap-2 mt-4"><button id="winch-auto-start" disabled class="bg-green-700 text-white rounded px-4 py-2 disabled:opacity-40">자동 시작·재개</button><button id="winch-auto-stop" class="bg-red-600 text-white rounded px-4 py-2 disabled:opacity-40">자동 보류·정지</button><button id="winch-auto-check" class="border rounded px-3 py-2 disabled:opacity-40">상태 확인</button></div>
      <p class="text-xs text-slate-500 mt-3">자동 운전이 기본 모드입니다. 운전 중 수동 올림·내림은 기록 단계를 한 칸 변경하고 5분 후 자동 판단을 재개합니다. 정지는 자동을 보류합니다. 단계를 알 수 없거나 0~3 범위를 벗어나면 현재 단계 확인 후 재개해야 합니다.</p>
    </dialog>`;
  const $ = id => document.getElementById('winch-' + id);
  let password = '', authenticated = false, epoch = 0, refreshId = 0, timer;
  const STATUS_POLL_MS=60000, ERROR_POLL_MS=300000;
  let pollDelay=STATUS_POLL_MS, refreshingEpoch=null;
  const batches = new Map();
  let autoBatch = null, autoBusy = false, autoReady = false, autoView = 0;
  let offsetBusy=false,offsetRevision=null;
  const offsetInputs=()=>['up','down'].flatMap(direction=>[1,2,3].map(n=>$(`offset-${direction}-${n}`)));
  function offsetButtons(){
    offsetInputs().forEach(input=>input.disabled=!authenticated||offsetBusy);
    $('offset-save').disabled=!authenticated||offsetBusy||offsetRevision===null;
    $('offset-load').disabled=!authenticated||offsetBusy;
  }
  function showOffsets(data){
    if(!Number.isSafeInteger(data.revision))throw Error('저장된 편차 정보를 확인하지 못했습니다.');
    offsetRevision=data.revision;
    for(const direction of ['up','down'])for(let n=1;n<=3;n++)$(`offset-${direction}-${n}`).value=data.offsets?.[direction]?.[n-1]??'';
    $('offset-status').textContent=data.configured?'저장된 편차를 불러왔습니다.':'예시 편차를 표시했습니다. 확인 후 저장하면 적용됩니다.';
  }
  async function loadOffsets(){
    if(!authenticated||offsetBusy)return;
    const ticket=epoch;offsetBusy=true;offsetButtons();
    try{const data=await api('offsets_get');if(ticket===epoch)showOffsets(data);}
    catch(error){if(ticket===epoch){if(error.status===401){lock(error.message);return;}offsetRevision=null;$('offset-status').textContent=error.message;}}
    finally{if(ticket===epoch){offsetBusy=false;offsetButtons();}}
  }
  async function saveOffsets(event){
    event.preventDefault();if(!authenticated||offsetBusy||offsetRevision===null)return;
    if(offsetInputs().some(input=>input.value.trim()===''||!input.checkValidity())){
      $('offset-status').textContent='올림·내림 편차 6개를 범위에 맞게 입력하세요.';return;
    }
    const offsets=Object.fromEntries(['up','down'].map(direction=>[direction,[1,2,3].map(n=>Number($(`offset-${direction}-${n}`).value))]));
    const ticket=epoch;offsetBusy=true;offsetButtons();
    try{const data=await api('offsets_save',null,{offsets,revision:offsetRevision});
      if(ticket!==epoch)return;showOffsets(data);$('offset-status').textContent='저장 완료 · 자동 운전 중인 배치는 다음 서버 확인부터 적용됩니다.';
      if(autoBatch)await checkAuto();
    }catch(error){if(ticket===epoch){if(error.status===401){lock(error.message);return;}$('offset-status').textContent=error.message;}}
    finally{if(ticket===epoch){offsetBusy=false;offsetButtons();}}
  }
  const status = text => { $('status').textContent = text; };
  function connectionStatus(){
    const failed=[...batches.values()].filter(batch=>!batch.state||batch.state.error).length;
    pollDelay=failed?ERROR_POLL_MS:STATUS_POLL_MS;
    status(failed?`로그인됨 · ${failed}개 배치 상태 확인 실패 · 5분 후 자동 재확인합니다. 각 배치의 오류를 확인하세요.`:
      `연결됨 · 등록된 윈치 ${batches.size}개 · 상태는 1분마다 갱신됩니다. 실제 조작 전 서버에서 다시 확인합니다.`);
  }
  const canMove = batch => authenticated && batch && !batch.busy && !batch.state?.error && batch.state?.online &&
    batch.state?.enabled && batch.state?.safetyMatches && batch.state.up === false && batch.state.down === false;
  function describe(state) {
    if (!state) return '상태 확인 중…';
    if (state.error) return state.error;
    if (!state.online) return '장치 오프라인';
    if (!state.enabled) return '현장 확인 및 제어 활성화 대기';
    if (!state.safetyMatches) return '안전 설정 불일치 · 제어 잠김';
    if (state.up === false && state.down === false) return '올림·내림 출력 OFF';
    if (state.up === true && state.down === false) return '올림 출력 ON';
    if (state.down === true && state.up === false) return '내림 출력 ON';
    return '출력 상태 불확실 · 현장 확인 필요';
  }
  function render() {
    document.querySelectorAll('[data-winch-batch]').forEach(panel => {
      const id = panel.dataset.winchBatch, batch = batches.get(id);
      panel.querySelector('[data-winch-message]').textContent = !authenticated ? '상단 비밀번호로 연결' : !batch ? '윈치 미등록 · 연결 예정' : batch.message || describe(batch.state);
      panel.querySelectorAll('[data-winch-action]').forEach(button => {
        const action = button.dataset.winchAction;
        button.disabled = action === 'stop' ? !authenticated || !batch : !canMove(batch);
        const seconds = batch?.[action + 'Seconds'];
        button.textContent = action === 'stop' ? '■ 정지' : `${action === 'up' ? '▲ 올림' : '▼ 내림'}${seconds ? ' ' + seconds + '초' : ''}`;
        button.onclick = event => { event.stopPropagation(); operate(id, action); };
      });
      const autoButton=panel.querySelector('[data-winch-auto]');
      if(autoButton){
        autoButton.disabled=!authenticated||!batch||batch.busy;
        autoButton.textContent=batch?.state?.auto?.enabled?(batch.state.auto.paused?'자동 보류':'자동 운전 중'):'자동 설정';
        autoButton.onclick=event=>{event.stopPropagation();openAuto(id);};
      }
      const autoMessage=panel.querySelector('[data-winch-auto-message]');
      if(autoMessage)autoMessage.textContent=batch?.state?.auto ? autoSummary(batch.state.auto) : '';
    });
  }
  function cardHtml(id) {
    if (!/^[1-7]$/.test(String(id))) return '';
    return `<div data-winch-batch="${id}" class="w-28 shrink-0 border-l border-slate-100 pl-3" onclick="event.stopPropagation()">
      <div class="flex flex-col gap-2" role="group" aria-label="육성 ${id}배치 윈치">
        <button type="button" data-winch-action="up" aria-label="육성 ${id}배치 윈치 올림" disabled class="bg-blue-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">▲ 올림</button>
        <button type="button" data-winch-action="stop" aria-label="육성 ${id}배치 윈치 정지" disabled class="bg-red-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">■ 정지</button>
        <button type="button" data-winch-action="down" aria-label="육성 ${id}배치 윈치 내림" disabled class="bg-blue-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">▼ 내림</button>
      </div><p data-winch-message role="status" class="text-[10px] leading-snug text-slate-500 mt-2 break-keep">상단 비밀번호로 연결</p>
      <button type="button" data-winch-auto disabled aria-label="육성 ${id}배치 자동 설정" class="mt-2 w-full border border-green-600 text-green-800 rounded py-1.5 text-xs font-bold disabled:opacity-35">자동 설정</button>
      <p data-winch-auto-message class="text-[10px] leading-snug text-slate-500 mt-1 break-keep"></p></div>`;
  }
  async function api(action, batchId, extra={}) {
    const response = await fetch('/.netlify/functions/winch', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Winch-Password': password },
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
      batches.set(id, { ...current, state, message: '', version: current?.version || 0,
        upSeconds: state.upSeconds, downSeconds: state.downSeconds });
    }
    for (const id of batches.keys()) if (!Object.hasOwn(data.batches, id)) batches.delete(id);
  }
  function lock(message = '잠겼습니다.') {
    closeAuto();
    epoch++; refreshId++; password = ''; authenticated = false; batches.clear(); clearTimeout(timer);
    refreshingEpoch=null;pollDelay=STATUS_POLL_MS;
    offsetBusy=false;offsetRevision=null;offsetInputs().forEach(input=>input.value='');offsetButtons();
    $('offset-status').textContent='제어 비밀번호로 연결한 후 편차를 입력하고 저장하세요.';
    $('password').value = ''; $('login').style.display = ''; $('connect').disabled = false;
    $('refresh').hidden = true;$('diagnose').hidden=true;$('diagnostic').textContent=''; status(message+' 설정된 자동 운전은 유지됩니다.'); render();
  }
  async function refresh() {
    if (!authenticated || refreshingEpoch===epoch) return;
    const ticket = epoch, requestId = ++refreshId;
    refreshingEpoch=ticket;
    const versions = new Map([...batches].map(([id, batch]) => [id, batch.version]));
    try {
      const data = await api('status_all');
      if (ticket !== epoch || requestId !== refreshId) return;
      applyStates(data, versions);
      connectionStatus();
    } catch (error) {
      if (ticket !== epoch || requestId !== refreshId) return;
      if (error.status === 401) { lock(error.message); return; }
      pollDelay=ERROR_POLL_MS;
      for (const [id, batch] of batches) if (!batch.busy && batch.version === versions.get(id)) {
        batch.state = null; batch.message = error.message;
      }
      status(error.message+' · 5분 후 자동 재확인합니다.');
    } finally { if(refreshingEpoch===ticket)refreshingEpoch=null; }
    render();
    if(ticket===epoch&&authenticated)poll();
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (authenticated && !document.hidden) await refresh();
      if (authenticated) poll();
    }, pollDelay);
  }
  async function operate(id, action) {
    const batch = batches.get(id);
    if (!authenticated || !batch || (action !== 'stop' && !canMove(batch))) return;
    if (action !== 'stop' && !window.confirm(`육성 ${id}배치 윈치를 ${batch[action + 'Seconds']}초 ${action === 'up' ? '올림' : '내림'} 작동하시겠습니까? 자동 운전 중이면 기록 단계를 한 칸 갱신하고 5분 후 자동 판단을 재개합니다. 단계를 알 수 없거나 범위를 벗어나면 자동은 보류됩니다.`)) return;
    const ticket = epoch, version = ++batch.version;
    batch.busy = true; batch.state = null; batch.message = '명령 전달 중…'; render();
    try {
      const result = await api(action, id);
      if (ticket === epoch && version === batch.version) batch.message = result.message;
    } catch (error) {
      if (ticket !== epoch || version !== batch.version) return;
      if (error.status === 401) { lock(error.message); return; }
      batch.message = error.message + ' 현장에서 상태를 확인하세요.';
    } finally {
      if (ticket === epoch && version === batch.version) {
        batch.busy = false; render();
        // Polling will recheck relay outputs; never retry a movement command.
        poll();
      }
    }
  }
  function autoSummary(auto){
    const mode=auto.enabled?(auto.paused?'자동 보류':`자동 · ${auto.stage}단계`):'자동 설정 대기';
    return `${mode} · ${auto.reason||''}`;
  }
  function closeAuto(){autoView++;autoBatch=null;autoReady=false;autoBusy=false;$('auto-dialog').close();}
  function autoButtons(){
    $('auto-start').disabled=autoBusy||!autoReady||!['0','1','2','3'].includes($('auto-stage').value);
    $('auto-stop').disabled=autoBusy||!authenticated||!autoBatch;
    $('auto-check').disabled=autoBusy;
    $('auto-stage').disabled=autoBusy;
  }
  async function checkAuto(){
    const id=autoBatch,ticket=epoch,view=++autoView;
    if(!authenticated||!id)return;
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
      if(error.status===401){lock(error.message);return;}
      $('auto-sensor').textContent=error.message;
      $('auto-settings').textContent='설정온도를 확인하지 못했습니다. 상태 확인을 다시 눌러주세요.';
    }finally{if(ticket===epoch&&view===autoView){autoBusy=false;autoButtons();}}
  }
  async function openAuto(id){
    if(!authenticated||!batches.has(id))return;
    autoBatch=id;$('auto-stage').value='';$('auto-title').textContent=`육성 ${id}배치 자동 운전`;
    $('auto-state').textContent='상태 확인 중…';$('auto-dialog').showModal();await checkAuto();
  }
  async function changeAuto(action){
    if(autoBusy||!authenticated||!autoBatch)return;
    if(action==='auto_on'&&(!autoReady||!['0','1','2','3'].includes($('auto-stage').value)))return;
    const id=autoBatch,stage=Number($('auto-stage').value);
    if(action==='auto_on'&&!window.confirm(`육성 ${id}배치의 실제 상태가 ${stage}단계인지 확인하셨습니까? 자동 운전을 시작·재개하면 브라우저를 닫아도 5분 후부터 배치 설정온도와 저장한 편차에 따라 올림 5초·내림 6초씩 작동합니다.`))return;
    const ticket=epoch,view=++autoView;
    const batch=batches.get(id),version=++batch.version;
    batch.busy=true;batch.state=null;autoBusy=true;autoReady=false;autoButtons();render();
    try{
      const result=await api(action,id,action==='auto_on'?{stage}:{});
      if(ticket!==epoch||view!==autoView)return;
      $('auto-state').textContent=result.message;batch.message=result.message;
    }catch(error){
      if(ticket!==epoch||view!==autoView)return;
      if(error.status===401){lock(error.message);return;}
      $('auto-state').textContent=error.message+' 상태 확인 후 다시 확인하세요.';
    }finally{
      if(ticket===epoch&&batch.version===version){batch.busy=false;render();await refresh();}
      if(ticket===epoch&&view===autoView){autoBusy=false;autoButtons();}
    }
  }
  $('auto-close').onclick=closeAuto;
  $('offset-form').onsubmit=saveOffsets;
  $('offset-load').onclick=loadOffsets;
  $('auto-dialog').oncancel=()=>{autoView++;autoBatch=null;autoReady=false;autoBusy=false;};
  $('auto-stage').onchange=autoButtons;
  $('auto-check').onclick=checkAuto;
  $('auto-start').onclick=()=>changeAuto('auto_on');
  $('auto-stop').onclick=()=>changeAuto('auto_off');
  $('diagnose').onclick=async()=>{
    if(!authenticated)return;
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
    catch(error){if(ticket===epoch){if(error.status===401)lock(error.message);else $('diagnostic').textContent=error.message;}}
    finally{if(ticket===epoch)$('diagnose').disabled=false;}
  };
  $('lock').onclick = () => lock();
  $('refresh').onclick = refresh;
  $('login').onsubmit = async event => {
    event.preventDefault(); if ($('connect').disabled) return;
    password = $('password').value; $('password').value = ''; $('connect').disabled = true;
    const ticket = ++epoch; status('등록된 윈치 연결 확인 중…');
    try {
      const data = await api('status_all');
      if (ticket !== epoch) return;
      applyStates(data, new Map()); authenticated = true;
      $('login').style.display = 'none'; $('refresh').hidden = false;$('diagnose').hidden=false;$('diagnose').disabled=false;
      connectionStatus(); render(); poll();await loadOffsets();
    } catch (error) { if (ticket === epoch) lock(error.message); }
    finally { if (ticket === epoch) $('connect').disabled = false; }
  };
  window.addEventListener('pagehide', () => lock());
  window.FarmWinch = { cardHtml, render };
  document.dispatchEvent(new Event('winch-ready'));
})();
