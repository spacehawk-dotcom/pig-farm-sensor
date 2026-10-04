const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const data=new Map();const merge=(a,b)=>{for(const [k,v]of Object.entries(b))a[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(a[k]||{},v):v;return a;};
 const reference=path=>({path,id:path.split('/').at(-1),collection:n=>collection(path+'/'+n),set:async(v,o)=>data.set(path,o?.merge?merge(data.get(path)||{},structuredClone(v)):structuredClone(v))});
 const snap=r=>({ref:r,id:r.id,exists:data.has(r.path),data:()=>data.get(r.path)});
 const collection=path=>({path,doc:id=>reference(path+'/'+id),where:(k,op,v)=>({path,filter:[k,v]}),get:async()=>get({path})});
 const get=async q=>q.id?snap(q):{docs:[...data.keys()].filter(k=>k.startsWith(q.path+'/')&&k.slice(q.path.length+1).indexOf('/')<0).map(k=>snap(reference(k))).filter(d=>!q.filter||d.data()[q.filter[0]]===q.filter[1])};
 const db={doc:reference,collection,runTransaction:async fn=>{const writes=[];await fn({get,set:(r,v,o)=>writes.push(()=>r.set(v,o))});for(const w of writes)await w();}};
 const handlers={};const ctx={exports:handlers,require:name=>name==='firebase-admin'?{initializeApp(){},firestore:()=>db}:name==='./cycle-core'?require('../firebase-functions/cycle-core'):{onDocumentWritten:(_,fn)=>fn,onValueCreated:(_,fn)=>fn},Date,Number,Promise};
 vm.runInNewContext(fs.readFileSync(require.resolve('../firebase-functions/index.js'),'utf8'),ctx);
 const emit=async(before,after,time)=>{data.set('farms/sungamfarm/grower/batch_1',after);await handlers.trackGrowerCycle({params:{batchId:'batch_1'},time:new Date(time).toISOString(),data:{before:{data:()=>before},after:{data:()=>after,updateTime:{toMillis:()=>time}}}});};
 return {data,emit,handlers};
}
test('active cycle ends at zero, retries do not duplicate and re-entry is a separate cycle',async()=>{
 const f=fixture(),t=Date.parse('2026-10-01T01:00:00Z'),b={pigs:20,growerInDate:'2026-10-01'};
 await f.emit(undefined,b,t);await f.emit(undefined,b,t);await f.emit(b,{...b,pigs:0},t+1000);await f.emit({...b,pigs:0},{...b,pigs:30,growerInDate:'2026-10-02'},t+86400000);
 const rows=[...f.data].filter(([k])=>/ventilation_cycles\/[^/]+$/.test(k)).map(([,v])=>v);
 assert.equal(rows.length,2);assert.equal(rows[0].end,t+1000);assert.equal(rows[1].end,null);
});
test('sensor event seeds occupied room and archives temperatures idempotently',async()=>{
 const f=fixture(),time=Date.parse('2026-10-01T01:00:00Z');f.data.set('farms/sungamfarm/grower/batch_1',{pigs:30,growerInDate:'2026-10-01'});
 const e={params:{sampleId:String(time)},data:{val:()=>({'육성_1배치':{temp:25},'외부온도':{temp:18}})}};
 await f.handlers.archiveCycleTemperature(e);await f.handlers.archiveCycleTemperature(e);
 const rows=[...f.data].filter(([k])=>k.includes('/temperature_days/')).map(([,v])=>v);
 assert.equal(rows.length,1);assert.equal(Object.keys(rows[0].samples).length,1);assert.equal(rows[0].samples[time].inside,25);
});
