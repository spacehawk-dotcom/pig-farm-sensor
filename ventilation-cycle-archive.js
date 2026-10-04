import {collection,doc,getDoc,getDocs,setDoc,query,where,runTransaction} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import {ref,get,query as rq,orderByKey,startAt,endAt} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js';
export function createCycleArchive(host,connections){
 const C=window.VentilationCycles,escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=n=>n==null?'사육 중':new Date(n+9*3600000).toISOString().slice(0,16).replace('T',' ');
 let room=null,current=null,cycles=[],token=0,chart=null;
 host.innerHTML=`<h3 class="font-bold text-lg mb-3">📁 입식 회차별 설정·온도 기록</h3><p class="text-xs text-slate-500 mb-3">입식일부터 0두가 된 시점까지 한 회차로 구분합니다. 설정별 온도 변화는 관측 결과이며, 설정이 변화의 원인임을 뜻하지 않습니다. Home Assistant의 5분 주기 전송을 켜 두면 자동으로 회차와 온도를 보관합니다. 종료 시각은 HA가 0두를 처음 확인한 시각입니다.</p><div class="flex flex-wrap gap-2"><select id="cycle-select" aria-label="입식 회차 선택" class="border rounded p-2 flex-1"></select><button id="cycle-refresh" class="border rounded px-3">회차 목록 새로고침</button><button id="cycle-register" class="border rounded px-3">현재 입식 회차 등록</button><button id="cycle-view" class="bg-blue-600 text-white rounded px-3">회차 기록 보기</button></div><p id="cycle-collector" class="text-xs text-slate-500 mt-2"></p><p id="cycle-status" role="status" class="text-sm my-3"></p><div id="cycle-result"></div>`;
 const $=id=>host.querySelector('#cycle-'+id);
 const base='farms/sungamfarm';
 async function refresh(){const stamp=++token;const {db}=connections();if(!db||!room)return;
  $('status').textContent='회차 목록 조회 중…';
  try {const snap=await getDocs(query(collection(db,base+'/ventilation_cycles'),where('room','==',room)));if(stamp!==token)return;
   const collector=await getDoc(doc(db,base+'/ventilation_cycle_state',encodeURIComponent(room)));if(stamp!==token)return;
   const last=collector.data()?.lastCheckedAt;
   $('collector').textContent=Number.isFinite(last)?`Home Assistant 마지막 회차 확인: ${date(last)}${Date.now()-last>900000?' · 15분 넘게 갱신되지 않았습니다. 자동화를 확인하세요.':''}`:'Home Assistant 회차 확인 이력이 없습니다. 전송 스크립트와 cycle_archive 설정을 적용하세요.';
   cycles=snap.docs.map(d=>({...d.data(),id:d.id})).filter(c=>Number.isFinite(c.start)&&c.start<=Date.now()&&(c.end===null||Number.isFinite(c.end)&&c.end>=c.start)).sort((a,b)=>b.start-a.start);
   if(current&&!cycles.some(c=>c.start===current.start&&c.end===null))cycles.unshift({...current,pending:true});
   $('select').innerHTML=cycles.map((c,i)=>`<option value="${i}">${escape(date(c.start).slice(0,10))} 입식 → ${escape(c.status==='closure_pending'?'종료 이벤트 확인 중':date(c.end))}${c.pending?' · 등록 전':''}</option>`).join('');
   $('status').textContent=cycles.length?`${room.replace('_',' ')} · ${cycles.length}개 회차. 회차를 선택하고 기록 보기를 누르세요.`:'보관된 회차가 없습니다. 기존 기록은 자동으로 다른 회차에 합치지 않습니다.';
   $('result').replaceChildren();if(chart){chart.destroy();chart=null;}
  }catch(e){if(stamp===token)$('status').textContent='회차 조회 실패: '+e.message;}
 }
 async function view(){const c=cycles[Number($('select').value)];if(!c)return;const stamp=++token;const {db,rtdb}=connections();$('result').replaceChildren();if(chart){chart.destroy();chart=null;}
  try{
   const snap=await getDocs(query(collection(db,base+'/ventilation_records'),where('room','==',c.room)));
   const records=snap.docs.map(d=>({...d.data(),id:d.id})).filter(r=>C.inCycle(r,c)&&Array.isArray(r.groups)&&r.groups.length===4&&r.groups.every(g=>g&&['t','min','max','diff'].every(k=>Number.isFinite(g[k])))).sort((a,b)=>a.start-b.start);
   const days=await getDocs(collection(db,base+'/ventilation_cycles/'+c.id+'/temperature_days'));
   const points=new Map();days.forEach(d=>Object.values(d.data().samples||{}).forEach(p=>points.set(p.time,p)));
   const end=Math.min(c.end??Date.now(),Date.now());let missing=0;
   // Read day by day; older sensor records are not assumed to exist.
   for(let t=Math.floor((c.start+32400000)/C.DAY)*C.DAY-32400000;t<=end;t+=C.DAY){
    if(stamp!==token)return;$('status').textContent=`${date(c.start).slice(0,10)} 회차 온도 조회 중 · ${date(t).slice(0,10)}`;
    const day=new Date(t+32400000).toISOString().slice(0,10);

    const raw=await get(rq(ref(rtdb,'history_logs'),orderByKey(),startAt(String(Math.max(c.start,t))),endAt(String(Math.min(end,t+C.DAY-1)))));
    if(!raw.exists())missing++;
    const archive={};
    raw.forEach(d=>{const inside=d.val()?.[c.room]?.temp,out=d.val()?.['외부온도']?.temp,time=Number(d.key);if(inside!=null&&inside!==''&&Number.isFinite(Number(inside))){const point={time,inside:Number(inside),outside:out!=null&&out!==''&&Number.isFinite(Number(out))?Number(out):null};points.set(time,point);archive[String(time)]=point;}});
    if(!c.pending && Object.keys(archive).length)await setDoc(doc(db,base+'/ventilation_cycles/'+c.id+'/temperature_days',day),{day,samples:archive},{merge:true});
   }
   if(stamp!==token)return;
   const samples=[...points.values()].filter(p=>p.time>=c.start&&p.time<=end).sort((a,b)=>a.time-b.time);
   $('status').textContent=`${c.room.replace('_',' ')} · ${date(c.start)} ~ ${date(c.end)} · 실제 설정 ${records.length}건 · 온도 ${samples.length}건${missing?' · 미수집/보관되지 않은 날짜 '+missing+'일':''}${c.pending?' · 회차 등록 전':''}`;
   $('result').innerHTML='<div class="h-64 mb-3"><canvas id="cycle-chart"></canvas></div><div class="overflow-auto max-h-96"><table class="w-full text-xs text-left"><thead><tr><th>실제 설정 관찰 기간</th><th>1~4그룹 온도 / 전압 / 편차</th><th>실내 온도 변화</th></tr></thead><tbody>'+records.map(r=>{const st=C.stats(samples,r);return `<tr class="border-t"><td class="p-2">${escape(date(r.start))}<br>${escape(date(r.end))}</td><td class="p-2">${r.groups.map((g,i)=>`${i+1}: ${g.t}℃ / ${g.min}~${g.max}% / ${g.diff}℃`).map(escape).join('<br>')}</td><td class="p-2">${st?`${st.min.toFixed(1)}~${st.max.toFixed(1)}℃<br>처음→끝 ${st.change.toFixed(1)}℃ · ${st.count}건${st.gaps?' · 30분 초과 결측':''}`:'온도 기록 없음'}</td></tr>`;}).join('')+'</tbody></table></div>';
   if(typeof Chart==='undefined')throw Error('그래프 라이브러리 로드 실패');
   const series=key=>samples.flatMap((p,i)=>i&&p.time-samples[i-1].time>1800000?[{x:samples[i-1].time+1,y:null},{x:p.time,y:p[key]}]:[{x:p.time,y:p[key]}]);
   chart=new Chart($('chart'),{type:'line',data:{datasets:[{label:'실내 온도',data:series('inside'),borderColor:'#ef4444',pointRadius:0,borderWidth:1.5},{label:'외기 온도',data:series('outside'),borderColor:'#94a3b8',pointRadius:0,borderWidth:1.5},...Array.from({length:4},(_,i)=>({label:`실제 확인 ${i+1}그룹 설정온도`,data:records.flatMap(r=>[{x:r.start,y:r.groups[i].t},{x:r.end,y:r.groups[i].t},{x:r.end+1,y:null}]),borderColor:['#22c55e','#14b8a6','#f97316','#a855f7'][i],pointRadius:0,borderDash:[4,4],spanGaps:false}))]},options:{responsive:true,maintainAspectRatio:false,parsing:false,scales:{x:{type:'linear',min:c.start,max:end,ticks:{maxTicksLimit:6,callback:n=>date(n).slice(5,16)}},y:{title:{display:true,text:'℃'}}},plugins:{tooltip:{callbacks:{title:items=>items.length?date(items[0].parsed.x):''}}}}});
  }catch(e){if(stamp===token)$('status').textContent='회차 기록 조회 실패: '+e.message;}
 }
 $('refresh').onclick=refresh;$('view').onclick=view;$('select').onchange=()=>{token++;$('result').replaceChildren();if(chart){chart.destroy();chart=null;}};
 $('register').onclick=async()=>{if(!current){$('status').textContent='현재 입식일과 사육 두수를 먼저 확인하세요.';return;}try{await registerRecord({room:current.room,start:current.start});await refresh();}catch(e){$('status').textContent='회차 등록 실패: '+e.message;}};
 return {setRoom(next,batch){const st=C.start(batch),n=C.count(batch);const nextCurrent=st!==null&&n>0?{id:C.identity(next,st),room:next,start:st,end:null,status:'active',batchId:String(batch.id)}:null;const changed=room!==next||JSON.stringify(current)!==JSON.stringify(nextCurrent);room=next;current=nextCurrent;if(changed)refresh();},attach:registerRecord};
 async function registerRecord(record){
  const {db}=connections();const st=current;if(!st||record.room!==st.room)throw Error('입식일과 현재 사육 회차를 확인하세요.');
  if(record.start<st.start)throw Error('관찰 시작은 현재 회차의 입식 시점 이후여야 합니다.');
  const stateRef=doc(db,base+'/ventilation_cycle_state',encodeURIComponent(st.room));
  const cycle=await runTransaction(db,async tx=>{const state=(await tx.get(stateRef)).data();const id=state?.activeId||st.id;const reference=doc(db,base+'/ventilation_cycles',id);const saved=(await tx.get(reference)).data();
   if(saved?.end!=null)throw Error('종료된 회차입니다. 배치 정보를 새로고침하세요.');
   const row=saved||{...st,id,startBasis:'입식일',createdAt:Date.now()};if(record.start<row.start)throw Error('회차 입식일 이전 기록입니다.');
   if(!saved){tx.set(reference,row);tx.set(stateRef,{activeId:id,room:st.room,eventTime:0},{merge:true});}return row;});
  return {...record,cycleId:cycle.id,cycleStart:cycle.start};
 }
}
