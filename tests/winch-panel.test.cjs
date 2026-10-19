const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../winch-panel.js'), 'utf8');
const healthy = {online:true,enabled:true,safetyMatches:true,up:false,down:false,upSeconds:5,downSeconds:6};
const response = (data,status=200) => ({ok:status===200,status,headers:{get:()=> 'application/json'},json:async()=>data});
function fixture() {
  const nodes = Object.fromEntries(['panel','login','password','connect','lock','status','refresh','diagnose','diagnostic','auto-dialog','auto-title','auto-close','auto-state','auto-sensor','auto-stage','auto-start','auto-stop','auto-check'].map(id=>['winch-'+id,{style:{},disabled:false,value:'',hidden:false,showModal(){this.open=true;},close(){this.open=false;}}]));
  const panels = Array.from({length:7},(_,i)=>{
    const message = {textContent:''};
    const buttons = ['up','stop','down'].map(action=>({dataset:{winchAction:action},disabled:true}));
    const autoButton={},autoMessage={};
    return {dataset:{winchBatch:String(i+1)},message,buttons,autoButton,autoMessage,querySelector:selector=>selector==='[data-winch-auto]'?autoButton:selector==='[data-winch-auto-message]'?autoMessage:message,querySelectorAll:()=>buttons};
  });
  const calls=[];
  let reply=async()=>response({batches:{'2':healthy}});
  const context=vm.createContext({
    document:{getElementById:id=>nodes[id],querySelectorAll:()=>panels,dispatchEvent:()=>{},hidden:false},
    window:{addEventListener:()=>{},confirm:()=>true},
    fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return reply();},
    setTimeout:()=>1,clearTimeout:()=>{},AbortSignal:{timeout:()=>({})},Event:class {}
  });
  vm.runInContext(source,context);
  const render=()=>context.window.FarmWinch.render();
  const login=async()=>{nodes['winch-password'].value='not-a-real-password';await nodes['winch-login'].onsubmit({preventDefault(){}});};
  const click=(id,action)=>panels[id-1].buttons.find(b=>b.dataset.winchAction===action).onclick({stopPropagation(){}});
  return {nodes,panels,calls,render,login,click,setReply:fn=>{reply=fn;},context};
}
test('failed authentication keeps login visible and all batch controls locked',async()=>{
  const f=fixture();f.setReply(async()=>response({error:'제어 비밀번호를 확인하세요.'},401));await f.login();
  assert.equal(f.nodes['winch-login'].style.display,'');
  assert.equal(f.nodes['winch-password'].value,'');
  assert(f.panels.every(p=>p.buttons.every(b=>b.disabled)));
});
test('one login unlocks only registered safe batches and survives sensor rerender',async()=>{
  const f=fixture();await f.login();f.render();
  assert.equal(f.nodes['winch-login'].style.display,'none');
  assert(f.panels[1].buttons.every(b=>!b.disabled));
  for(const i of [0,2,3,4,5,6])assert(f.panels[i].buttons.every(b=>b.disabled));
  assert.match(f.panels[0].message.textContent,/미등록/);
  f.setReply(async()=>response({accepted:true,message:'명령 전달됨'}));f.click(2,'up');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls.at(-1),{action:'up',batchId:'2'});
  assert.equal(f.panels[1].buttons[0].disabled,true);
  f.nodes['winch-lock'].onclick();assert(f.panels.every(p=>p.buttons.every(b=>b.disabled)));
});
test('late login response cannot unlock after manual lock',async()=>{
  const f=fixture();let resolve;
  f.setReply(()=>new Promise(r=>{resolve=r;}));const pending=f.login();
  f.nodes['winch-lock'].onclick();resolve(response({batches:{'2':healthy}}));await pending;
  assert.equal(f.nodes['winch-login'].style.display,'');assert(f.panels.every(p=>p.buttons.every(b=>b.disabled)));
});
test('stale polling response cannot re-enable a batch after a movement request',async()=>{
  const f=fixture();await f.login();let resolve;
  f.setReply(()=>new Promise(r=>{resolve=r;}));const pending=f.nodes['winch-refresh'].onclick();
  f.setReply(async()=>response({accepted:true,message:'명령 전달됨'}));f.click(2,'down');
  await new Promise(r=>setImmediate(r));resolve(response({batches:{'2':healthy}}));await pending;
  assert.equal(f.panels[1].buttons[0].disabled,true);
  assert.equal(f.panels[1].buttons[2].disabled,true);
});
test('lost authentication relocks every batch',async()=>{
  const f=fixture();await f.login();f.setReply(async()=>response({error:'인증 실패'},401));await f.nodes['winch-refresh'].onclick();
  assert.equal(f.nodes['winch-login'].style.display,'');assert(f.panels.every(p=>p.buttons.every(b=>b.disabled)));
});
test('offline or unsafe batches cannot move but retain stop',async()=>{
  for(const changes of [{online:false},{enabled:false},{safetyMatches:false},{up:true},{error:'연결 실패'}]){
    const f=fixture();f.setReply(async()=>response({batches:{'2':{...healthy,...changes}}}));await f.login();
    assert.equal(f.panels[1].buttons[0].disabled,true);assert.equal(f.panels[1].buttons[1].disabled,false);assert.equal(f.panels[1].buttons[2].disabled,true);
  }
});

test('auto setup only reads state until explicit stage selection and start',async()=>{
  const f=fixture();await f.login();
  f.setReply(async()=>response({auto:{enabled:false,stage:null,reason:'수동'},sample:{temperature:24,measuredAt:1800000000000}}));
  f.panels[1].autoButton.onclick({stopPropagation(){}});await new Promise(r=>setImmediate(r));
  assert.equal(f.nodes['winch-auto-dialog'].open,true);assert.equal(f.calls.at(-1).action,'auto_status');
  assert.equal(f.nodes['winch-auto-start'].disabled,true);
  f.nodes['winch-auto-stage'].value='1';f.nodes['winch-auto-stage'].onchange();
  assert.equal(f.nodes['winch-auto-start'].disabled,false);
  f.setReply(async()=>response({message:'자동 설정',batches:{'2':{...healthy,auto:{enabled:true,stage:1}}}}));
  await f.nodes['winch-auto-start'].onclick();
  assert(f.calls.some(c=>c.action==='auto_on'&&c.batchId==='2'&&c.stage===1));
  assert(!f.calls.some(c=>['up','down','stop'].includes(c.action)));
});

test('sensor errors and already enabled automatic mode block start',async()=>{
  for(const data of [{auto:{enabled:false},sensorError:'센서 오래됨'},{auto:{enabled:true,stage:1},sample:{temperature:24,measuredAt:1800000000000}}]){
    const f=fixture();await f.login();f.setReply(async()=>response(data));
    f.panels[1].autoButton.onclick({stopPropagation(){}});await new Promise(r=>setImmediate(r));
    f.nodes['winch-auto-stage'].value='1';f.nodes['winch-auto-stage'].onchange();assert.equal(f.nodes['winch-auto-start'].disabled,true);
  }
});

test('screen lock closes dialog and never cancels running server automation',async()=>{
  const f=fixture();await f.login();const count=f.calls.length;f.nodes['winch-lock'].onclick();
  assert.equal(f.nodes['winch-auto-dialog'].open,false);assert.equal(f.calls.length,count);
});
