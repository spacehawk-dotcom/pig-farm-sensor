const test = require('node:test');
const assert = require('node:assert/strict');
require('../ventilation.js');
const V = globalThis.FarmVentilation;
const now = Date.parse('2026-10-27T10:00:00+09:00');
const dateForAge = age => new Date(Date.UTC(2026,9,27)-(age-20)*86400000).toISOString().slice(0,10);
const pens = (counts, ages) => ({penDetails:counts,penDates:ages.map(dateForAge)});

test('observed herd pen ages use headcount-weighted means, not first pen or stocking plus 70',()=>{
  const cases=[
    [1,[32,32,33,32,31,32,33,33,31,32],[137,130,130,123,123,137,137,130,123,123],321,129],
    [2,[32,29,31,30,32,32,33,32,30,31],[158,158,158,151,151,144,144,144,144,144],312,150],
    [4,[31,5,3,15,5,18,12,12,7,17],[179,179,207,214,214,207,207,193,186,207],125,198],
    [5,[30,30,30,31,31,32,29,31,30,30],[116,116,109,109,109,116,109,109,102,102],304,110],
    [6,[30,30,30,30,30,31,29,30,30,31],[74,74,81,81,81,95,95,95,88,88],301,85],
    [7,[22,30,31,29,29,32,31,30,29,32],[179,179,179,172,172,165,165,165,172,172],295,172]
  ];
  for(const [id,counts,ages,count,age] of cases){
    const data={id,...pens(counts,ages),pigs:999,avgAge:30,date:'2026-09-01',growerInDate:'2026-10-19'};
    assert.equal(V.calculateBatchCount(data),count);
    const result=V.calculatePigAge(data,'육성사',now);
    assert.equal(result.age,age,`batch ${id}`);
    assert.equal(result.stockDiffDays,8);
    assert.match(result.sourceMsg,/가중평균/);
  }
});

test('empty pens do not affect age; shipment and mortality counts reweight immediately',()=>{
  const data=pens([10,30,0],[100,140,200]);
  assert.equal(V.calculatePigAge(data,'육성사',now).age,130);
  data.penDetails=[10,0,0];
  assert.equal(V.calculatePigAge(data,'육성사',now).age,100);
  assert.equal(V.calculateBatchCount({...data,pigs:40}),10);
  assert.equal(V.calculateBatchCount({penDetails:[0,0],pigs:40}),0);
  assert.equal(V.calculateBatchCount({pigs:0,count:40}),0);
});

test('weaning dates fall back per pen, partial unknown dates are disclosed',()=>{
  const data={penDetails:[10,20],penDates:[dateForAge(100),''],weaningDate:dateForAge(130)};
  assert.equal(V.calculatePigAge(data,'이유사',now).age,120);
  delete data.weaningDate;
  assert.equal(V.calculatePigAge(data,'육성사',now).age,100);
  assert.match(V.calculatePigAge(data,'육성사',now).sourceMsg,/10\/30두/);
  assert.equal(V.calculatePigAge({date:dateForAge(80)},'육성사',now).age,80);
});

test('Korean calendar day, valid date formats and stocking date independence',()=>{
  const data={penDetails:[5],penDates:['2026-10-01'],growerInDate:'2026-10-25'};
  assert.equal(V.calculatePigAge(data,'육성사',Date.parse('2026-10-26T14:59:59Z')).age,45);
  assert.equal(V.calculatePigAge(data,'육성사',Date.parse('2026-10-26T15:00:00Z')).age,46);
  for(const date of ['2026.10.01','261001','20261001',new Date('2026-10-01T00:00:00+09:00'),{seconds:Date.parse('2026-10-01T00:00:00+09:00')/1000}])
    assert.equal(V.calculatePigAge({...data,penDates:[date]},'육성사',now).age,46);
  assert.equal(V.calculatePigAge({...data,growerInDate:''},'육성사',now).stockDiffDays,null);
  const invalid=V.calculatePigAge({penDetails:[5],penDates:['2026-02-30'],age:NaN},'육성사',now);
  assert.equal(invalid.age,30);assert.match(invalid.sourceMsg,/날짜 없음/);
});

test('saved calculation records use the same current pens and save date',()=>{
  const record=require('../ventilation-setting-record.js');
  const result=record.build({id:'test',batchId:'batch_1',type:'육성사',data:{...pens([10,30],[100,140]),pigs:999,avgAge:30},updates:{},now},V);
  assert.equal(result.count,40);assert.equal(result.age,130);
  assert.equal(result.weight,V.calculateWeight(130));
});
