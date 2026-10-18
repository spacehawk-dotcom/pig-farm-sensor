(() => {
  const host = document.getElementById('winch-panel');
  if (!host) return;
  host.innerHTML = `<div class="flex flex-wrap justify-between items-center gap-2"><h2 class="font-bold text-lg">육성사 윈치</h2><button id="winch-lock" class="text-sm underline">잠금</button></div>
    <form id="winch-login" class="flex flex-wrap gap-2 mt-3"><label class="text-sm">제어 비밀번호 <input id="winch-password" type="password" autocomplete="off" required class="border rounded p-2 max-w-full" placeholder="관리자에게 받은 비밀번호"></label><button id="winch-connect" class="bg-slate-700 text-white rounded px-4 py-2 disabled:opacity-40">연결 확인</button></form>
    <p id="winch-status" role="status" class="text-sm text-slate-700 mt-3">상단에서 한 번 연결하면 등록된 육성 배치의 윈치를 사용할 수 있습니다.</p>
    <button id="winch-refresh" hidden class="text-sm underline mt-2">전체 상태 새로고침</button>
    <p class="text-xs text-slate-500 mt-2">장치의 자동 꺼짐 설정을 사용합니다. 표시 상태는 릴레이 출력이며 실제 윈치 위치가 아닙니다.</p>`;
  const $ = id => document.getElementById('winch-' + id);
  let password = '', authenticated = false, epoch = 0, refreshId = 0, timer;
  const batches = new Map();
  const status = text => { $('status').textContent = text; };
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
    });
  }
  function cardHtml(id) {
    if (!/^[1-7]$/.test(String(id))) return '';
    return `<div data-winch-batch="${id}" class="w-28 shrink-0 border-l border-slate-100 pl-3" onclick="event.stopPropagation()">
      <div class="flex flex-col gap-2" role="group" aria-label="육성 ${id}배치 윈치">
        <button type="button" data-winch-action="up" aria-label="육성 ${id}배치 윈치 올림" disabled class="bg-blue-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">▲ 올림</button>
        <button type="button" data-winch-action="stop" aria-label="육성 ${id}배치 윈치 정지" disabled class="bg-red-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">■ 정지</button>
        <button type="button" data-winch-action="down" aria-label="육성 ${id}배치 윈치 내림" disabled class="bg-blue-600 text-white rounded-lg py-2 px-1 text-xs font-bold disabled:opacity-35 disabled:cursor-not-allowed">▼ 내림</button>
      </div><p data-winch-message role="status" class="text-[10px] leading-snug text-slate-500 mt-2 break-keep">상단 비밀번호로 연결</p></div>`;
  }
  async function api(action, batchId) {
    const response = await fetch('/.netlify/functions/winch', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Winch-Password': password },
      body: JSON.stringify({ action, ...(batchId ? { batchId } : {}) }), cache: 'no-store', signal: AbortSignal.timeout(35000)
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
    epoch++; refreshId++; password = ''; authenticated = false; batches.clear(); clearTimeout(timer);
    $('password').value = ''; $('login').style.display = ''; $('connect').disabled = false;
    $('refresh').hidden = true; status(message); render();
  }
  async function refresh() {
    if (!authenticated) return;
    const ticket = epoch, requestId = ++refreshId;
    const versions = new Map([...batches].map(([id, batch]) => [id, batch.version]));
    try {
      const data = await api('status_all');
      if (ticket !== epoch || requestId !== refreshId) return;
      applyStates(data, versions);
      status(`연결됨 · 등록된 윈치 ${batches.size}개 · 각 배치 카드에서 조작하세요.`);
    } catch (error) {
      if (ticket !== epoch || requestId !== refreshId) return;
      if (error.status === 401) { lock(error.message); return; }
      for (const [id, batch] of batches) if (!batch.busy && batch.version === versions.get(id)) {
        batch.state = null; batch.message = error.message;
      }
      status(error.message);
    }
    render();
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (authenticated && !document.hidden) await refresh();
      if (authenticated) poll();
    }, 5000);
  }
  async function operate(id, action) {
    const batch = batches.get(id);
    if (!authenticated || !batch || (action !== 'stop' && !canMove(batch))) return;
    if (action !== 'stop' && !window.confirm(`육성 ${id}배치 윈치를 ${batch[action + 'Seconds']}초 ${action === 'up' ? '올림' : '내림'} 작동하시겠습니까?`)) return;
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
      $('login').style.display = 'none'; $('refresh').hidden = false;
      status(`연결됨 · 등록된 윈치 ${batches.size}개 · 각 배치 카드에서 조작하세요.`); render(); poll();
    } catch (error) { if (ticket === epoch) lock(error.message); }
    finally { if (ticket === epoch) $('connect').disabled = false; }
  };
  window.addEventListener('pagehide', () => lock());
  window.FarmWinch = { cardHtml, render };
  document.dispatchEvent(new Event('winch-ready'));
})();
