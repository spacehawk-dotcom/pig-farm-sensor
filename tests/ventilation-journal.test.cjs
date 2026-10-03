const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const L=require('../ventilation-learning.js');
function setup(fail=false, cache='[]') {
    const elements=new Map();
    const host={innerHTML:'',querySelector(id){if(!elements.has(id))elements.set(id,{value:'',checked:false,disabled:false,textContent:'',innerHTML:'',classList:{toggle(){}},addEventListener(){}});return elements.get(id);}};
    const writes=[];let storage=cache,id=0;
    const ctx=vm.createContext({window:{VentilationLearning:L},Date,JSON,Map,Number,String,Error,Promise,
        localStorage:{getItem:()=>storage,setItem:(_,v)=>{storage=v;}},crypto:{randomUUID:()=>`test-${++id}`},setTimeout:()=>0});
    vm.runInContext(fs.readFileSync(require.resolve('../ventilation-journal.js'),'utf8').replace('export function','function'),ctx);
    const api={subscribe(room,success){success([]);return()=>{};},async save(r){writes.push(r);if(fail)throw Error('permission-denied');}};
    const ui=ctx.createVentilationJournal(host,api);
    const opt=Object.fromEntries(['f500_1','f500_2','f800_1','f800_2'].map(k=>[k,{t:24,min:20,max:100,diff:4}]));
    ui.setBatch({room:'육성_1배치',count:300,weight:60,age:110},opt);
    const get=id=>host.querySelector('#vj-'+id);
    get('weight-source').value='predicted';get('flow').value='';get('observation').value='normal';get('context').value='입기 3cm';get('note').value='';
    get('defaults').onclick();
    return {get,writes,stored:()=>JSON.parse(storage),ui,opt};
}
test('confirmation required; successful writes append distinct records and survive reload',async()=>{
    const s=setup();await s.get('save').onclick();assert.equal(s.writes.length,0);
    s.get('confirm').checked=true;await s.get('save').onclick();
    assert.equal(s.stored().length,1);assert.equal(s.stored()[0].synced,true);
    assert.equal(s.stored()[0].source,'manual_actual');
    s.get('confirm').checked=true;await s.get('save').onclick();
    assert.equal(s.stored().length,2);assert.notEqual(s.stored()[0].id,s.stored()[1].id);
    const loaded=setup(false,JSON.stringify(s.stored()));assert.match(loaded.get('total').textContent,/2건/);
});
test('cloud rejection preserves local data and retry uses the same record ID',async()=>{
    const s=setup(true);s.get('confirm').checked=true;await s.get('save').onclick();
    assert.equal(s.stored().length,1);assert.equal(s.stored()[0].synced,false);
    assert.match(s.get('status').textContent,/permission-denied/);
    await s.get('retry').onclick();assert.equal(s.writes.length,2);assert.equal(s.writes[0].id,s.writes[1].id);
    assert.equal(s.stored().length,1);
});
test('blank required setting is not silently recorded as zero',async()=>{
    const s=setup();s.get('g1-min').value='';s.get('confirm').checked=true;await s.get('save').onclick();
    assert.equal(s.writes.length,0);assert.equal(s.stored().length,0);
});
