const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../simulation-core.js');
require('../ventilation.js');
const V = globalThis.FarmVentilation;
const html = fs.readFileSync(require('node:path').join(__dirname, '../simu.html'), 'utf8');
const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], {value:'',textContent:''}]));
elements.sensorSelect.value='육성_5배치';
const today=new Date(), entered=new Date(today.getFullYear(),today.getMonth(),today.getDate()-6);
const stock=`${entered.getFullYear()}-${entered.getMonth()+1}-${entered.getDate()}`;
const batch={id:5,pigs:307,avgAge:76,growerInDate:stock};
const ctx=vm.createContext({ C,V,Date,console,$:id=>elements[id],farmBatches:[batch],farmLoaded:true,
    farmDirty:false,groupDirty:false,outdoorState:'ready',outdoorReadings:[{time:Date.now()-1000,temp:30},{time:Date.now()-2000,temp:20}],runSimulation:()=>{} });
vm.runInContext(html.slice(html.indexOf('        function selectedFarmBatch()'),html.indexOf('        function requirement()')),ctx);
ctx.loadSelectedBatch();
const expected=V.calculateOptimalSettings(76,V.calculateWeight(76),307,null,'육성사',6,[30,20]);
['f500_1','f500_2','f800_1','f800_2'].forEach((key,i)=>{
    for(const [field,value] of Object.entries({t:expected[key].t,p:expected[key].diff,min:expected[key].min,max:expected[key].max})) assert.equal(elements[`g${i+1}_${field}`].value,value);
});
assert.equal(elements.g1_t.value,25,'stocking adjustment remains without outdoor adjustment');
assert.equal(elements.g3_p.value,3);
assert.equal(elements.pigWeight.value,V.calculateWeight(76));
ctx.groupDirty=true; elements.g1_t.value=27;
ctx.outdoorReadings=[]; ctx.syncGroupSettings();
assert.equal(elements.g1_t.value,27,'manual edits survive background updates');
ctx.loadSelectedBatch(true);
assert.equal(elements.g1_t.value,25,'reload replaces manual scenario with current farm settings');
ctx.outdoorState='error';ctx.syncGroupSettings();
assert.equal(elements.g1_t.value,'','failed outdoor load must not show unverified defaults');
ctx.outdoorState='ready';ctx.farmBatches=[{id:5,pigs:0,status:'empty'}];ctx.loadSelectedBatch(true);
assert.equal(elements.g1_t.value,'');assert.equal(elements.pigWeight.value,'');
ctx.farmBatches=[batch,{...batch}];ctx.loadSelectedBatch(true);
assert.equal(elements.g1_t.value,'','ambiguous matching must clear previous batch settings');
ctx.farmBatches=[{id:5,pigs:101,avgAge:335}];ctx.loadSelectedBatch(true);
assert.equal(elements.pigWeight.value,110,'same capped growth curve as farm app');
assert.equal(elements.g1_min.value,16);
// Current recommendation weather is independent from the historical chart range.
const callbacks=[],queries=[];
Object.assign(ctx,{rtdb:{},outdoorRequest:0,unsubscribeOutdoor:null,
 ref:()=>{},orderByKey:()=>{},startAt:value=>({start:value}),endAt:value=>({end:value}),query:(...args)=>{queries.push(args);return args;},
 onValue:(_q,success,error)=>{callbacks.push({success,error});return ()=>{};}});
ctx.fetchOutdoor();
assert.equal(Number(queries[0].at(-1).end)-Number(queries[0].at(-2).start),48*3600000);
callbacks[0].success({forEach(fn){for(const [key,temp] of [[Date.now()-1000,30],[Date.now()-2000,20]])if(fn({key,val:()=>({'외부온도':{temp}})}))break;}});
assert.equal(ctx.outdoorReadings.length,2);
ctx.fetchOutdoor();callbacks[0].error();
assert.equal(ctx.outdoorState,'ready','ignore stale outdoor query callbacks');
callbacks[1].error();assert.equal(elements.g1_t.value,'');
console.log('PASS: farm group mapping, acclimatization, outdoor correction, manual edits, reload, empty/duplicate batches and independent weather query.');
