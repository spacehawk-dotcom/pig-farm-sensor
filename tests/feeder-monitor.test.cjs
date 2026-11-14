const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../feeder-core.js');
const {acceptReport,readReport,validateReport}=require('../netlify/functions/lib/feeder-store.cjs');
const stamp='2026-11-14 22:15:05';
const frame=(amount=1800,sow='6-189')=>`2026-11-14 22:15:05 : [RESPONSE]\r\nEATLOG\r\n2026 11 14 22 16 ${amount} 2000 90 10 2000 90 0 1 1 1 0\r\n${sow}\r\n4766\r\n0\r\n`;
const row=(id=31)=>C.normalize({device_id:id,sow_id:'6-189',target_amount:2000,dispensed_amount:1800,update_time:stamp});

test('KOCA field [5] matches the confirmed 1800/2000/90 screenshot, not constant [8]=10',()=>{
  const [r]=C.parseLog(frame(),31);assert.equal(r.amount,1800);assert.equal(r.target,2000);assert.equal(r.percent,90);assert.equal(r.sowId,'6-189');
  assert.equal(r.measuredAt,Date.parse('2026-11-14T22:15:05+09:00'));
  // The last numeric field before amount is minutes, not seconds.
  assert.equal(new Date(r.measuredAt).toISOString(),'2026-11-14T13:15:05.000Z');
});
test('partial/malformed records are ignored and network heartbeat is not feeding',()=>{
  assert.equal(C.parseLog('2026-11-14 22:15:05 : [RESPONSE]\nNWCHECK\n1800\n',31).length,0);
  assert.equal(C.parseLog(frame().replace('1800','NaN'),31).length,0);
  assert.equal(C.parseLog(frame().split('6-189')[0],31).length,0);
  assert.equal(C.parseLog(frame(),73).length,0);
});
test('empty pens do not inflate active totals or low-feeding alerts',()=>{
  const [empty]=C.parseLog(frame(0,'0'),44);const stats=C.summary([row(),empty],{archive:true});
  assert.equal(stats.active,1);assert.equal(stats.empty,1);assert.equal(stats.low,0);assert.equal(stats.amount,1800);assert.equal(stats.missing,70);
});
test('stale data and yesterday are excluded in live totals but retained in archive',()=>{
  const r=row(),now=r.measuredAt+16*60000;assert.equal(C.status(r,{now}),'stale');assert.equal(C.status(r,{archive:true,now}),'partial');
  assert.equal(C.summary([r],{now}).amount,0);
  const midnight=C.normalize({...r,measuredAt:Date.parse('2026-11-14T23:59:00+09:00')});
  assert.equal(C.status(midnight,{now:Date.parse('2026-11-15T00:01:00+09:00')}),'stale');
});
test('completion is 100%, under 50% needs checking, and zero target stays unset',()=>{
  const r=row();assert.equal(C.status({...r,amount:2000},{archive:true}),'complete');
  assert.equal(C.status({...r,amount:999},{archive:true}),'low');assert.equal(C.status({...r,amount:1000},{archive:true}),'partial');
  assert.equal(C.status({...r,target:0},{archive:true}),'unset');
});
test('invalid amounts, IDs and timestamps never reach totals',()=>{
  for(const edit of [{amount:-1},{target:NaN},{deviceId:0},{deviceId:31.1},{measuredAt:NaN}])assert.throws(()=>C.normalize({...row(),...edit}));
});
test('out-of-order snapshots cannot overwrite a more recent reading',()=>{
  const old=row(),fresh={...old,amount:2000,measuredAt:old.measuredAt+1000};
  assert.equal(C.merge([fresh],[old])[0].amount,2000);
});
test('ingestion rejects duplicate feeders and future dates',()=>{
  const r=row();assert.throws(()=>validateReport({rows:[r,r]},r.measuredAt));
  assert.throws(()=>validateReport({rows:[{...r,measuredAt:r.measuredAt+120000}]},r.measuredAt));
});
test('cloud report persists last readings through partial heartbeat and rejects rollback',async()=>{
  let saved;const ref={get:async()=>({data:()=>saved})};
  const db={doc:()=>ref,runTransaction:async fn=>fn({get:ref.get,set:(_r,value)=>{saved=value;}})};
  const r=row(),now=r.measuredAt+3000;
  await acceptReport(db,{rows:[r]},now);await acceptReport(db,{rows:[]},now+1000);
  assert.equal((await readReport(db)).rows[0].amount,1800);
  await acceptReport(db,{rows:[{...r,amount:2000,measuredAt:r.measuredAt+1000}]},now+2000);
  await acceptReport(db,{rows:[r]},now+3000);
  assert.equal((await readReport(db)).rows[0].amount,2000);assert.equal((await readReport(db)).receivedAt,now+3000);
});
