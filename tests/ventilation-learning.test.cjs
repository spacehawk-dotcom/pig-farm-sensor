const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../ventilation-learning.js');
const now = Date.parse('2026-10-03T18:00:00+09:00');
const groups = [24,24,26,29].map(t=>({t,min:20,max:100,diff:4}));
const current = { now, room:'육성_1배치', weight:60, count:300, context:'입기 3cm / 순환 켬', low:24, high:26 };
function fixture() {
    const records = [1,2,3].map(i=>({id:String(i),room:current.room,groups,start:now-i*L.DAY-6.5*L.HOUR,end:now-i*L.DAY,
        count:300,weight:60,age:110,context:current.context,observation:'normal'}));
    const samples=[];
    for(let day=0;day<=3;day++)for(let i=0;i<72;i++)samples.push({time:now-day*L.DAY-6*L.HOUR+i*L.BIN,inside:25,outside:18});
    return {records,samples};
}
test('3 separate comparable days yield an actually used setting with evidence',()=>{
    const {records,samples}=fixture(); const result=L.recommend(records,samples,current);
    assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].days,3);
    assert.deepEqual(result.candidates[0].groups,groups);assert.equal(result.candidates[0].inRange,1);
});
test('fewer days, unhealthy/unknown, changed room/equipment/herd/weather are withheld',()=>{
    for(const mutate of [r=>r.pop(),r=>r[0].observation='cough',r=>r[0].observation='unknown',r=>r[0].room='육성_2배치',r=>r[0].context='입기 6cm',r=>r[0].count=100,r=>r[0].weight=100]) {
        const {records,samples}=fixture();mutate(records);assert.equal(L.recommend(records,samples,current).candidates.length,0);
    }
    const {records,samples}=fixture();samples.filter(p=>p.time<now-L.DAY/2).forEach(p=>p.outside=30);
    assert.equal(L.recommend(records,samples,current).candidates.length,0);
});
test('gaps, stale current sensors and duplicate intervals cannot create evidence',()=>{
    let {records,samples}=fixture();
    assert.equal(L.recommend(records,samples.filter(p=>p.time<now-L.HOUR),current).candidates.length,0);
    assert.equal(L.recommend([...records,{...records[0],id:'duplicate'}],samples,current).candidates.length,0);
    const start=records[0].start;
    samples=samples.filter(p=>!(p.time>start+L.HOUR&&p.time<start+2*L.HOUR));
    assert.equal(L.recommend(records,samples,current).candidates.length,0);
});
test('unstable or out-of-goal settings are withheld, not extrapolated',()=>{
    let {records,samples}=fixture();samples.filter(p=>p.time<now-L.DAY/2).forEach(p=>p.inside=28);
    assert.equal(L.recommend(records,samples,current).candidates.length,0);
    ({records,samples}=fixture());
    samples.filter(p=>p.time<now-L.DAY/2).forEach(p=>p.inside=(p.time%(6*L.HOUR))<L.HOUR?28:24);
    assert.equal(L.recommend(records,samples,{...current,high:29}).candidates.length,0);
});
test('validation rejects blanks, future periods, bad ranges and invalid percent',()=>{
    const {records}=fixture();const r=records[0];
    assert.throws(()=>L.validate({...r,end:now+1},now));
    assert.throws(()=>L.validate({...r,start:r.end+1},now));
    assert.throws(()=>L.validate({...r,count:0},now));
    assert.throws(()=>L.validate({...r,groups:groups.map(g=>({...g,min:101}))},now));
    assert.throws(()=>L.validate({...r,context:''},now));
    assert.ok(Number.isNaN(L.num('')));assert.ok(Number.isNaN(L.num(null)));
    assert.equal(L.bins([{time:now,inside:'',outside:18},{time:now,inside:25,outside:'--'}]).length,0);
});
