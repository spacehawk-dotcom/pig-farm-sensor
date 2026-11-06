const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../winch-panel.js'), 'utf8');
const healthy = {online:true,enabled:true,safetyMatches:true,up:false,down:false,upSeconds:5,downSeconds:6};
const response = (data,status=200) => ({ok:status===200,status,headers:{get:()=> 'application/json'},json:async()=>data});

test('cards show persistent request history and omit the four removed instructions',async()=>{
  const f=fixture();
  f.setReply(async()=>response({batches:{'2':{...healthy,signalHistory:[
    {at:Date.parse('2026-11-06T03:00:00Z'),action:'up',mode:'auto',temperature:26,status:'sent'},
    {at:Date.parse('2026-11-06T02:00:00Z'),action:'stop',mode:'manual',status:'registered'}
  ]}}}));
  await f.ready();f.render();
  assert.match(f.panels[1].history.textContent,/자동 올림 5초 · 26℃ · 신호 요청/);
  assert.match(f.panels[1].history.textContent,/수동 정지 · 요청 등록/);
  assert.match(f.panels[1].history.textContent,/12:00:00/);
  for(const text of ['서버에서 <b>5분마다','온도앱에서 저장한 1그룹 설정온도를 5분마다',
    '현재 단계 입력 없이 온도 변화를 감시합니다.','수동 올림·내림 후에는 5분 뒤 새 온도부터']){
    assert(!source.includes(text));
  }
});
function fixture() {
  const nodes = Object.fromEntries(['offset-form','offset-save','offset-load','offset-status','offset-up-1','offset-up-2','offset-up-3','offset-down-1','offset-down-2','offset-down-3','panel','status','refresh','diagnose','diagnostic','auto-dialog','auto-title','auto-close','auto-state','auto-settings','auto-up1','auto-up2','auto-up3','auto-down1','auto-down2','auto-down3','auto-sensor','auto-stage','auto-start','auto-stop','auto-check'].map(id=>['winch-'+id,{style:{},disabled:false,value:'',hidden:false,checkValidity(){return true;},showModal(){this.open=true;},close(){this.open=false;}}]));
  const panels = Array.from({length:7},(_,i)=>{
    const message = {textContent:''};
    const buttons = ['up','stop','down'].map(action=>({dataset:{winchAction:action},disabled:true}));
    const autoButton={},autoMessage={},history={};
    return {dataset:{winchBatch:String(i+1)},message,buttons,autoButton,autoMessage,history,querySelector:selector=>selector==='[data-winch-history]'?history:selector==='[data-winch-auto]'?autoButton:selector==='[data-winch-auto-message]'?autoMessage:message,querySelectorAll:()=>buttons};
  });
  const calls=[],timers=[];
  let reply=async()=>response({batches:{'2':healthy}});
  const context=vm.createContext({
    document:{getElementById:id=>nodes[id],querySelectorAll:()=>panels,dispatchEvent:()=>{},hidden:false},
    window:{addEventListener:()=>{},confirm:()=>true},
    fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return JSON.parse(options.body).action==='offsets_get'?response({configured:false,revision:0,offsets:null}):reply();},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},AbortSignal:{timeout:()=>({})},Event:class {}
  });
  vm.runInContext(source,context);
  const render=()=>context.window.FarmWinch.render();
  const ready=async()=>{await new Promise(resolve=>setImmediate(resolve));await nodes['winch-refresh'].onclick();};
  const click=(id,action)=>panels[id-1].buttons.find(b=>b.dataset.winchAction===action).onclick({stopPropagation(){}});
  return {nodes,panels,calls,timers,render,ready,click,setReply:fn=>{reply=fn;},context};
}

test('public signal controls remain usable without HA reports or status banners',async()=>{
  const f=fixture();await f.ready();
  for(const bridgeFresh of [true,false]){
    f.setReply(async()=>response({batches:{'2':{...healthy,online:false,bridgeFresh,safetyMatches:false,
      auto:{enabled:true,paused:false,reason:'신호 전송 미확인 · 자동 감시 유지'}}}}));
    await f.nodes['winch-refresh'].onclick();
    assert.equal(f.panels[1].message.hidden,true);
    assert.equal(f.panels[1].autoButton.textContent,'자동 운전 중');
    assert.equal(f.panels[1].buttons[0].disabled,false);
    assert.equal(f.panels[1].buttons[2].disabled,false);
  }
  f.setReply(async()=>response({message:'신호 요청을 보냈습니다.'}));
  f.click(2,'up');await new Promise(r=>setImmediate(r));
  assert.deepEqual(f.calls.filter(c=>c.action==='up'),[{action:'up',batchId:'2'}]);
});

test('stop refreshes the open popup and enables resume only after healthy paused status',async()=>{
  for(const sensorError of [undefined,'센서 갱신 지연']){
    const f=fixture();await f.ready();
    const settings={targetTemperature:24,up:[24.3,25.5,27],down:[23.7,22.5,21]};
    const sample={temperature:24,measuredAt:1800000000000};
    f.setReply(async()=>response({auto:{enabled:true,paused:false},settings,sample}));
    f.panels[1].autoButton.onclick({stopPropagation(){}});await new Promise(r=>setImmediate(r));
    assert.equal(f.nodes['winch-auto-start'].disabled,true);
    f.setReply(async()=>{
      const action=f.calls.at(-1).action;
      if(action==='auto_off')return response({message:'자동 보류'});
      if(action==='status_all')return response({batches:{'2':{...healthy,auto:{enabled:true,paused:true}}}});
      assert.equal(action,'auto_status');
      return response({auto:{enabled:true,paused:true},settings,sample,sensorError});
    });
    await f.nodes['winch-auto-stop'].onclick();
    assert.equal(f.nodes['winch-auto-start'].disabled,!!sensorError);
    assert.equal(f.nodes['winch-auto-dialog'].open,true);
    assert.equal(f.calls.at(-1).action,'auto_status');
    assert(!f.calls.some(c=>c.action==='auto_on'));
  }
});

test('healthy status polls once per minute and batch errors back off to five minutes',async()=>{
  const f=fixture();await f.ready();assert.equal(f.timers.at(-1).ms,60000);
  f.setReply(async()=>response({batches:{'2':{error:'Firestore 사용량 한도 (8)',upSeconds:5,downSeconds:6}}}));
  await f.timers.at(-1).fn();
  assert.equal(f.timers.at(-1).ms,300000);
  assert.doesNotMatch(f.nodes['winch-status'].textContent,/상태 확인 실패/);
  assert.equal(f.panels[1].buttons[0].disabled,false);
  f.setReply(async()=>response({batches:{'2':healthy}}));
  await f.nodes['winch-refresh'].onclick();
  assert.equal(f.timers.at(-1).ms,60000);
  assert.equal(f.panels[1].buttons[0].disabled,false);
  assert(f.calls.every(c=>['monitor','status_all','offsets_get'].includes(c.action)));
});

test('failed requests back off and concurrent refresh clicks share the in-flight request',async()=>{
  const f=fixture();await f.ready();let resolve;
  f.setReply(()=>new Promise(r=>{resolve=r;}));
  const pending=f.nodes['winch-refresh'].onclick();
  const before=f.calls.length;
  await f.nodes['winch-refresh'].onclick();assert.equal(f.calls.length,before);
  resolve(response({error:'저장소 사용량 한도'},503));await pending;
  assert.equal(f.timers.at(-1).ms,300000);
  assert.equal(f.panels[1].buttons[0].disabled,false);
});

test('hidden pages skip automatic status reads',async()=>{
  const f=fixture();await f.ready();f.context.document.hidden=true;
  const before=f.calls.length;await f.timers.at(-1).fn();
  assert.equal(f.calls.length,before);
});

test('page load enables only registered safe batches and survives sensor rerender',async()=>{
  const f=fixture();await f.ready();f.render();
  assert(f.panels[1].buttons.every(b=>!b.disabled));
  for(const i of [0,2,3,4,5,6])assert(f.panels[i].buttons.every(b=>b.disabled));
  assert.match(f.panels[0].message.textContent,/미등록/);
  f.setReply(async()=>response({accepted:true,message:'명령 전달됨'}));f.click(2,'up');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls.at(-1),{action:'up',batchId:'2'});
  assert.equal(f.panels[1].buttons[0].disabled,false);
});
test('page load enables all seven registered batches and diagnostics never actuates',async()=>{
  const f=fixture();
  const batches=Object.fromEntries(['1','2','3','4','5','6','7'].map(id=>[id,{...healthy}]));
  f.setReply(async()=>response({batches}));await f.ready();f.render();
  for(const panel of f.panels)assert(panel.buttons.every(b=>!b.disabled));
  f.setReply(async()=>response({state:{...healthy},message:'진단 정상'}));
  await f.nodes['winch-diagnose'].onclick();
  const diagnosticCalls=f.calls.filter(c=>c.action==='diagnostics');
  assert.deepEqual(diagnosticCalls.map(c=>c.batchId).sort(),['1','2','3','4','5','6','7']);
  assert(f.calls.every(c=>['monitor','status_all','offsets_get','diagnostics'].includes(c.action)));
  assert.match(f.nodes['winch-diagnostic'].textContent,/육성 1배치: 진단 정상/);
  assert.match(f.nodes['winch-diagnostic'].textContent,/육성 7배치: 진단 정상/);
});

test('stale polling response cannot clear a newer signal receipt',async()=>{
  const f=fixture();await f.ready();let resolve;
  f.setReply(()=>new Promise(r=>{resolve=r;}));const pending=f.nodes['winch-refresh'].onclick();
  f.setReply(async()=>response({accepted:true,message:'명령 전달됨'}));f.click(2,'down');
  await new Promise(r=>setImmediate(r));resolve(response({batches:{'2':healthy}}));await pending;
  assert.equal(f.panels[1].buttons[0].disabled,false);
  assert.equal(f.panels[1].message.textContent,'명령 전달됨');
});

test('only commissioned batches can submit movement signals; stop stays available',async()=>{
  for(const changes of [{online:false},{enabled:false},{safetyMatches:false},{up:true},{error:'연결 실패'}]){
    const f=fixture();f.setReply(async()=>response({batches:{'2':{...healthy,...changes}}}));await f.ready();
    assert.equal(f.panels[1].buttons[0].disabled,changes.enabled===false);assert.equal(f.panels[1].buttons[1].disabled,false);assert.equal(f.panels[1].buttons[2].disabled,changes.enabled===false);
  }
});

test('auto popup starts without a stage and opening never actuates',async()=>{
  const f=fixture();await f.ready();
  f.setReply(async()=>response({auto:{enabled:false,stage:null,reason:'수동'},settings:{targetTemperature:26,up:[26.3,27.5,29],down:[25.7,24.5,23]},sample:{temperature:24,measuredAt:1800000000000}}));
  f.panels[1].autoButton.onclick({stopPropagation(){}});await new Promise(r=>setImmediate(r));
  assert.equal(f.nodes['winch-auto-dialog'].open,true);assert.equal(f.calls.at(-1).action,'auto_status');
  assert.equal(f.nodes['winch-auto-start'].disabled,false);
  assert.equal(f.nodes['winch-auto-up1'].textContent,'26.3℃ 이상');
  assert.equal(f.nodes['winch-auto-down3'].textContent,'23℃ 이하');
  f.setReply(async()=>response({message:'자동 설정',batches:{'2':{...healthy,auto:{enabled:true,stage:1}}}}));
  await f.nodes['winch-auto-start'].onclick();
  assert(f.calls.some(c=>c.action==='auto_on'&&c.batchId==='2'&&!Object.hasOwn(c,'stage')));
  assert(!f.calls.some(c=>['up','down','stop'].includes(c.action)));
});

test('sensor errors and already enabled automatic mode block start',async()=>{
  for(const data of [{auto:{enabled:false},sensorError:'센서 오래됨'},
    {auto:{enabled:false},sample:{temperature:24,measuredAt:1800000000000},settingsError:'설정값 없음'},
    {auto:{enabled:false},sample:{temperature:24,measuredAt:1800000000000}},
    {auto:{enabled:true,stage:1},settings:{targetTemperature:24,up:[24.3,25.5,27],down:[23.7,22.5,21]},sample:{temperature:24,measuredAt:1800000000000}}]){
    const f=fixture();await f.ready();f.setReply(async()=>response(data));
    f.panels[1].autoButton.onclick({stopPropagation(){}});await new Promise(r=>setImmediate(r));
    assert.equal(f.nodes['winch-auto-start'].disabled,true);
  }
});

test('paused automatic mode can resume without entering a position',async()=>{
  const f=fixture();await f.ready();
  f.setReply(async()=>response({auto:{enabled:true,paused:true,stage:null,reason:'현재 단계 확인'},
    settings:{targetTemperature:23,up:[23.3,24.5,26],down:[22.7,21.5,20]},sample:{temperature:24,measuredAt:1800000000000}}));
  f.panels[1].autoButton.onclick({stopPropagation(){}});await new Promise(r=>setImmediate(r));
  assert.equal(f.nodes['winch-auto-start'].disabled,false);
  assert.equal(f.nodes['winch-auto-up3'].textContent,'26℃ 이상');
  assert.equal(f.nodes['winch-auto-down2'].textContent,'21.5℃ 이하');
  assert(f.calls.every(c=>['monitor','status_all','offsets_get','auto_status'].includes(c.action)));
});



test('six offset inputs save signed values without enabling or moving a winch',async()=>{
  const f=fixture();await f.ready();
  assert.equal(f.nodes['winch-offset-save'].disabled,false);
  const offsets={up:[0.3,1.5,3],down:[-0.3,-1.5,-3]};
  for(const direction of ['up','down'])offsets[direction].forEach((value,i)=>f.nodes[`winch-offset-${direction}-${i+1}`].value=String(value));
  f.setReply(async()=>response({configured:true,revision:1,offsets}));
  await f.nodes['winch-offset-form'].onsubmit({preventDefault(){}});
  assert.deepEqual(f.calls.at(-1),{action:'offsets_save',offsets,revision:0});
  assert(f.calls.every(c=>['monitor','status_all','offsets_get','offsets_save'].includes(c.action)));
  assert.match(f.nodes['winch-offset-status'].textContent,/저장 완료/);
});



test('page load enables registered controls without login or password headers and never actuates',async()=>{
  const f=fixture();await new Promise(resolve=>setImmediate(resolve));f.render();
  assert.equal(f.calls[0].action,'status_all');
  assert(f.panels[1].buttons.every(button=>!button.disabled));
  assert(!f.panels[1].autoButton.disabled);
  assert.equal(f.nodes['winch-offset-save'].disabled,false);
  assert(f.calls.every(c=>['status_all','offsets_get'].includes(c.action)));
  assert.doesNotMatch(source,/winch-password|winch-login|winch-lock|X-Winch-Password|제어 비밀번호/);
});
test('empty offsets never save',async()=>{
  const f=fixture();await f.ready();const count=f.calls.length;
  await f.nodes['winch-offset-form'].onsubmit({preventDefault(){}});
  assert.equal(f.calls.length,count);
});
