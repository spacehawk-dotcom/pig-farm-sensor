const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('input button validates and saves all 12 fields to the selected batch',async()=>{
 const html=fs.readFileSync(require.resolve('../temp.html'),'utf8');
 const code=html.slice(html.indexOf("        document.getElementById('group-settings-editor').addEventListener"),html.indexOf('        function getVentRate('));
 const nodes={},calls=[];
 const node=id=>nodes[id]??=( {value:'',textContent:'',disabled:false,addEventListener(type,fn){this[type]=fn;},checkValidity(){return this.value!=='';},reportValidity(){},click(){}} );
 for(let n=1;n<=4;n++){node(`ui_base_t_${n}`).value=String(23+n);node(`ui_p_${n}`).value='4';node(n===4?'ui_max_4':`ui_min_${n}`).value=n===4?'75':'20';}
 const ctx=vm.createContext({document:{getElementById:node,querySelectorAll:()=>[]},editorSaving:false,editorDirty:true,currentSelectedBatchId:'batch1',fetchedBatches:{batch1:{name:'1배치',type:'육성사',id:'1'}},db:{},doc:(_,path,id)=>({path,id}),updateDoc:async(ref,data)=>calls.push({ref,data}),serverTimestamp:()=>123,renderAllBatchesSummary:()=>{}});
 vm.runInContext(code,ctx);await node('save-group-settings').click();
 assert.equal(calls.length,1);assert.equal(calls[0].ref.path,'farms/sungamfarm/grower');assert.equal(Object.keys(calls[0].data).length,13);
 assert.equal(calls[0].data['ventilationOverrides.f800_2.max'],75);assert.equal(calls[0].data['ventilationOverrides.f500_1.diff'],4);assert.match(node('group-save-status').textContent,/저장 완료/);
 node('ui_base_t_1').value='';await node('save-group-settings').click();assert.equal(calls.length,1);
});
