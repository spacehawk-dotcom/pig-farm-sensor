(() => {
  const host=document.getElementById('winch-panel');
  if(!host)return;
  host.innerHTML=`<div class="flex flex-wrap justify-between items-center gap-2"><h2 class="font-bold text-lg">육성2 윈치</h2><button id="winch-lock" class="text-sm underline">잠금</button></div>
  <form id="winch-login" class="flex flex-wrap gap-2 mt-3"><label class="text-sm">제어 비밀번호 <input id="winch-password" type="password" autocomplete="off" required class="border rounded p-2" placeholder="관리자에게 받은 비밀번호"></label><button class="bg-slate-700 text-white rounded px-4 py-2">연결 확인</button></form>
  <div id="winch-controls" hidden class="mt-3"><div class="grid grid-cols-3 gap-2"><button id="winch-up" class="bg-blue-600 text-white rounded-lg p-3 font-bold disabled:opacity-40" disabled>▲ 올림 5초</button><button id="winch-stop" class="bg-red-600 text-white rounded-lg p-3 font-bold">■ 정지</button><button id="winch-down" class="bg-blue-600 text-white rounded-lg p-3 font-bold disabled:opacity-40" disabled>▼ 내림 6초</button></div><button id="winch-refresh" class="text-sm underline mt-3">상태 새로고침</button></div>
  <p id="winch-status" role="status" class="text-sm text-slate-700 mt-3">제어 비밀번호를 입력해 연결하세요.</p><p class="text-xs text-slate-500 mt-2">장치의 자동 꺼짐 설정을 사용합니다. 표시 상태는 릴레이 출력이며 실제 윈치 위치가 아닙니다.</p>`;
  const $=id=>document.getElementById('winch-'+id);
  let password='',busy=false,epoch=0,timer,state=null;
  const status=t=>{$('status').textContent=t;};
  function buttons(){for(const id of ['up','down'])$(id).disabled=busy||!state?.enabled||!state?.online||!state?.safetyMatches||state.up!==false||state.down!==false;}
  async function api(action){
    const response=await fetch('/.netlify/functions/winch',{method:'POST',headers:{'Content-Type':'application/json','X-Winch-Password':password},body:JSON.stringify({action}),cache:'no-store',signal:AbortSignal.timeout(35000)});
    const type=response.headers.get('content-type')||'';
    if(!type.includes('application/json'))throw Error('Netlify 서버 연결이 필요합니다. localhost의 정적 서버에서는 제어할 수 없습니다.');
    const data=await response.json();if(!response.ok)throw Error(data.error||'연결 실패');return data;
  }
  async function refresh(){
    const ticket=epoch;
    try{const next=await api('status');if(ticket!==epoch)return;state=next;
      status(!state.online?'장치 오프라인':!state.enabled?'조회 연결됨 · 관리자의 현장 확인 및 제어 활성화 대기':!state.safetyMatches?'상호잠금·자동 꺼짐 설정이 변경되어 제어를 잠갔습니다.':state.up===false&&state.down===false?'올림·내림 출력 OFF':state.up===true&&state.down===false?'올림 출력 ON':state.down===true&&state.up===false?'내림 출력 ON':'출력 상태 불확실 · 현장 확인 필요');
    }catch(e){if(ticket!==epoch)return;state=null;status(e.message);}
    buttons();
  }
  function poll(){clearTimeout(timer);timer=setTimeout(async()=>{if(password&&!busy&&!document.hidden)await refresh();if(password)poll();},5000);}
  function lock(){epoch++;password='';state=null;busy=false;clearTimeout(timer);$('password').value='';$('login').style.display='';$('controls').hidden=true;buttons();status('잠겼습니다.');}
  $('lock').onclick=lock;
  $('login').onsubmit=async event=>{event.preventDefault();password=$('password').value;$('password').value='';epoch++;$('login').style.display='none';$('controls').hidden=false;await refresh();poll();};
  $('refresh').onclick=refresh;
  for(const action of ['up','down','stop'])$(action).onclick=async()=>{
    if(!password||(busy&&action!=='stop'))return;
    if(action!=='stop'&&!window.confirm(`육성2 윈치를 ${action==='up'?'5초 올림':'6초 내림'} 작동하시겠습니까?`))return;
    const ticket=++epoch;busy=true;state=null;buttons();status('명령 전달 중…');
    try{const result=await api(action);if(ticket===epoch)status(result.message);}
    catch(e){if(ticket===epoch)status(e.message+' 결과가 불확실하면 Smart Life 또는 현장에서 확인하세요.');}
    finally{if(ticket===epoch){busy=false;buttons();clearTimeout(timer);timer=setTimeout(async()=>{await refresh();poll();},1000);}}
  };
  window.addEventListener('pagehide',lock);
})();
