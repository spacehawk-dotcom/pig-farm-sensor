const test=require('node:test');
const assert=require('node:assert/strict');
const {signals,label,plugin}=require('../winch-chart.js');
const events=[
  {at:100,action:'up',status:'sent',mode:'auto'},
  {at:200,action:'down',status:'sent',mode:'manual'},
  {at:150,action:'stop',status:'sent'},
  {at:160,action:'up',status:'registered'},
  {at:NaN,action:'up',status:'sent'},
  {at:300,action:'down',status:'sent'}
];
test('only sent directional requests in the selected interval become lines, including boundaries',()=>{
  assert.deepEqual(signals(events,100,200).map(e=>[e.at,e.action]),[[100,'up'],[200,'down']]);
  assert.deepEqual(signals(null,0,500),[]);
  assert.deepEqual(signals(events,201,299),[]);
  assert.match(label({...events[0],at:Date.parse('2026-11-09T00:01:02Z')}),/09:01:02.*자동 ▲ 올림/);
});
test('lines use the real time axis and hover details select the nearby signal',()=>{
  const moves=[],dashes=[],texts=[];
  const ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},lineTo(){},stroke(){},
    moveTo:(x,y)=>moves.push([x,y]),setLineDash:d=>dashes.push(d),fillText:t=>texts.push(t),
    measureText:t=>({width:t.length*5}),fillRect(){}};
  const chart={ctx,chartArea:{left:0,right:500,top:20,bottom:200},scales:{x:{min:0,max:250,getPixelForValue:v=>v*2}}};
  plugin.beforeDatasetsDraw(chart,{}, {history:events});
  assert.deepEqual(moves,[[200,20],[400,20]]);
  assert.deepEqual(dashes,[[],[4,3]]);
  const args={event:{type:'mousemove',x:403,y:70}};
  plugin.afterEvent(chart,args,{history:events});assert.equal(args.changed,true);
  plugin.afterDraw(chart,{}, {history:events});assert.match(texts.at(-1),/수동 ▼ 내림 신호 요청/);
  plugin.afterEvent(chart,{event:{type:'mouseout'}},{history:events});assert.equal(chart.$winchSignal,null);
});
