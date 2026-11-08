const test=require('node:test');
const assert=require('node:assert/strict');
const H=require('../ventilation-save-history.js');
const settings=()=>Object.fromEntries(['f500_1','f500_2','f800_1','f800_2'].map(key=>[key,{t:24,min:key==='f500_2'?0:25,max:100,diff:4}]));

function fixture() {
    const docs=new Map([['batch',{savedVentSettings:{date:'2026-11-07',settings:settings()}}]]);
    let id=0,fail=false;
    const ref=path=>({path,id:path.split('/').at(-1),collection:()=>({doc:key=>ref('history/'+(key||++id))})});
    const database={runTransaction:async fn=>{
        const pending=[];
        await fn({get:async r=>({exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))}),
            set:(r,v)=>pending.push([r.path,structuredClone(v)]),update:(r,v)=>pending.push([r.path,{...docs.get(r.path),...structuredClone(v)}])});
        if(fail)throw Error('write rejected');
        pending.forEach(([k,v])=>docs.set(k,v));
    }};
    return {docs,database,batch:ref('batch'),fail:()=>fail=true};
}
test('every save appends, preserves the legacy snapshot once, and updates latest atomically',async()=>{
    const f=fixture(),input=settings();
    const first=await H.save(f.database,f.batch,input,1000);
    input.f500_1.min=35;
    const second=await H.save(f.database,f.batch,input,1000);
    assert.notEqual(first.id,second.id);
    assert.equal(f.docs.get('history/'+first.id).settings.f500_1.min,25);
    assert.equal(f.docs.get('history/'+second.id).settings.f500_1.min,35);
    assert.equal(f.docs.get('history/legacy').date,'2026-11-07');
    assert.equal(f.docs.get('batch').savedVentSettings.id,second.id);
    assert.equal(f.docs.size,4);
    const before=structuredClone(f.docs);f.fail();
    await assert.rejects(H.save(f.database,f.batch,input,2000));
    assert.deepEqual(f.docs,before);
});
test('missing batch and invalid settings do not produce saved records',async()=>{
    const f=fixture();f.docs.delete('batch');
    await assert.rejects(H.save(f.database,f.batch,settings()),/배치/);
    assert.equal(f.docs.size,0);
    assert.throws(()=>H.create('x',{}),/설정/);
});
test('history uses Korean save times, safely renders legacy dates and shows group settings',()=>{
    const record=H.create('x',settings(),Date.parse('2026-11-08T15:01:02Z'));
    assert.equal(record.date,'2026-11-09');
    const html=H.renderRecord(record,true);
    assert.match(html,/24℃/);assert.match(html,/최소환기 OFF/);assert.match(html,/편차 4℃/);
    const legacy=H.renderRecord(H.legacyRecord({date:'<img src=x>',settings:settings()}));
    assert(!legacy.includes('<img'));assert.match(legacy,/시각 없음/);
});
test('history loads 20 at a time and continues after the last document without dropping older saves',async()=>{
    const all=Array.from({length:23},(_,i)=>({id:String(i),data:()=>H.create(String(i),settings(),23000-i*1000)}));
    const nodes=Object.fromEntries(['list','status','count','more'].map(key=>[key,{textContent:'',hidden:false,disabled:false,html:'',insertAdjacentHTML(_,value){this.html+=value;}}]));
    const container={isConnected:true,querySelector:selector=>nodes[selector.slice(6,-1)]};
    const cursors=[];
    const batch={collection:()=>({orderBy:()=>({limit:size=>{
        let start=0;
        return {startAfter(cursor){cursors.push(cursor.id);start=Number(cursor.id)+1;return this;},get:async()=>{
            const docs=all.slice(start,start+size);return {docs,size:docs.length,empty:!docs.length};
        }};
    }})})};
    await H.mount(container,batch);
    assert.equal(nodes.more.hidden,false);assert.match(nodes.count.textContent,/20건/);
    await nodes.more.onclick();
    assert.deepEqual(cursors,['19']);assert.match(nodes.count.textContent,/23건/);
    assert.equal(nodes.more.hidden,true);
});
