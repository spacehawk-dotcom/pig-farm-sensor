const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const C = require('../simulation-core.js');
const s = { g1:{t:24,p:2,min:30,max:100},g2:{t:25,p:3,min:0,max:100},g3:{t:26,p:4,min:0,max:100},g4:{t:28,p:2,min:0,max:50} };
C.validateSettings(s);
for(const [temp,want] of [[23,30],[24,30],[24.9999,30],[25,65],[25.9999,65],[26,100],[40,100]]) assert.equal(C.rate(temp,s.g1),want);
assert.equal(C.rate(25.9,s.g2),0);
assert(Math.abs(C.rate(26,s.g2)-100/3)<1e-10);
assert.equal(C.rate(29,s.g4),25);
assert.equal(C.rate(30,s.g4),50);
assert.equal(C.rate(24.9,s.g1),C.rate(24.1,s.g1));
assert.throws(()=>C.validateSettings({...s,g2:{...s.g2,p:0}}));
assert.throws(()=>C.validateSettings({...s,g1:{...s.g1,min:101}}));
assert.throws(()=>C.validateSettings({...s,g1:{...s.g1,t:24.5}}));
assert.throws(()=>C.validateSettings({...s,g1:{...s.g1,min:NaN}}));
assert.deepEqual(C.CAPS,[13920,20880,35930,35930]);
assert.equal(C.flow({v1:100,v2:100,v3:100,v4:100}),106660);
assert.equal(C.flow(C.rates(40,s)),88695);
const now = 1800000000000;
const row=(time,temp,out=0)=>({time,data:{test:{temp},'외부온도':{temp:out}}});
const normalized = C.normalize([row(now,0),row(now-5000,10),row(now-5000,11),row(now-C.DAY-1,20),row(now+1,30),row(now-1000,''),row(now-2000,'x'),row(now-3000,null),row(now-4000,Infinity)],'test',now);
assert.deepEqual(normalized,[{time:now-5000,inTemp:11,outTemp:0},{time:now,inTemp:0,outTemp:0}]);
assert.deepEqual(C.normalize([row(now,2)],'missing',now),[]);
const historicStart=Date.parse('2026-09-20T00:00:00+09:00');
const historicEnd=Date.parse('2026-09-22T00:00:00+09:00');
const historicRange=C.validateRange(historicStart,historicEnd,now);
assert.equal(C.parseKoreanInput('2026-09-20T00:00'),historicStart);
assert.equal(C.toKoreanInput(historicStart),'2026-09-20T00:00');
assert(Number.isNaN(C.parseKoreanInput('2026-02-30T12:00')));
assert(Number.isNaN(C.parseKoreanInput('')));
assert.throws(()=>C.validateRange(historicEnd,historicStart,now));
assert.throws(()=>C.validateRange(historicStart,historicStart,now));
assert.throws(()=>C.validateRange(historicStart,now+1,now));
assert.throws(()=>C.validateRange(historicStart,historicStart+32*C.DAY,now));
assert.equal(C.validateRange(historicStart,historicStart+31*C.DAY,now).start,historicStart);
const historical=C.normalize([row(historicStart-1,8),row(historicStart,9),row(historicEnd,10),row(historicEnd+1,11),row(now,12)],'test',historicRange);
assert.deepEqual(historical.map(p=>p.inTemp),[9,10]);
for(const hours of [24,72,168]) {
    const range=C.presetRange(hours,now);
    assert.equal(range.end-range.start,hours*3600000);
    assert(range.end<=now && now-range.end<60000);
    assert.equal(C.parseKoreanInput(C.toKoreanInput(range.end)),range.end);
}
const irregular=[0,9,20,31,44,59,70].map((min,i)=>({time:now+min*60000,inTemp:28-i*.4}));
assert(C.hourDrops(irregular).pairs>0);
assert(C.hourDrops(irregular).maxDrop>1.5);
assert.equal(C.hourDrops([{time:now,inTemp:30},{time:now+3600000,inTemp:25}]).pairs,0);
assert.equal(C.hourDrops(irregular.slice(0,3)).pairs,0);
assert.deepEqual(C.requirements(50,300),{min:3600,max:39000,perMin:12,perMax:130,range:'34–68kg'});
assert.equal(C.requirements(68,300).min,5100);
assert.equal(C.requirements(100,300).max,61500);
assert.equal(C.requirements(100.1,300),null);
assert.equal(C.requirements(50,0),null);
assert.equal(C.requirements(50,1.5),null);
assert.equal(C.requirements(50,300,'mwps').min,7*C.CFM_TO_CMH*300);
assert.equal(C.estimatedWeight(70),30);
assert.equal(C.estimatedWeight(181),null);
const html=fs.readFileSync(path.join(__dirname, '../simu.html'),'utf8');
new vm.SourceTextModule(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size,'duplicate DOM IDs');
for(const match of html.matchAll(/\$\('([^']+)'\)/g)) assert(ids.includes(match[1]),'Missing element '+match[1]);
assert(!html.includes('updateDoc('),'preview must not save scenarios to DB');
assert(!html.includes('limitToLast('),'history must be timestamp bounded');
assert(html.includes('endAt(String(activeRange.end))'),'query must enforce the end of historical ranges');
// Firebase stops snapshot iteration on a truthy return value. Array.push must
// not be implicitly returned by the forEach callback.
const callbacks=[];
const capturedQueries=[];
let canceled=0;
const fetchContext=vm.createContext({
    rtdb:{},historyRequest:0,unsubscribeHistory:null,rawCache:[],historyReceived:false,historyFailed:false,
    activeRange:historicRange,processData:()=>{},console,
    ref:(_db,path)=>path,orderByKey:()=>({order:true}),startAt:value=>({start:value}),endAt:value=>({end:value}),
    query:(...args)=>{capturedQueries.push(args);return args;},
    onValue:(_query,success,error)=>{callbacks.push({success,error});return ()=>{canceled++;};}
});
vm.runInContext(html.slice(html.indexOf('        function fetchData()'),html.indexOf('        function processData()')),fetchContext);
const fakeSnapshot={forEach(action){for(let i=0;i<3;i++){if(action({key:String(historicStart+i*60000),val:()=>({test:{temp:20+i}})}))break;}}};
fetchContext.fetchData();
callbacks[0].success(fakeSnapshot);
assert.equal(fetchContext.rawCache.length,3,'must read all records, not just the first');
assert.equal(fetchContext.historyReceived,true);
assert.equal(capturedQueries[0].at(-1).end,String(historicEnd));
fetchContext.fetchData();
assert.equal(canceled,1);
assert.equal(fetchContext.rawCache.length,0,'clear old records when the range changes');
callbacks[0].success(fakeSnapshot);
assert.equal(fetchContext.rawCache.length,0,'ignore late snapshots from the previous query');
callbacks[1].success(fakeSnapshot);
assert.equal(fetchContext.rawCache.length,3);
console.log('PASS: control, capacities, KST dates, historical range boundaries, invalid ranges, presets, irregular sampling, requirement ranges, syntax and DOM IDs.');
