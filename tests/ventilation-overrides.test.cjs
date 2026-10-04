const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
require('../ventilation.js');
const V=globalThis.FarmVentilation;
test('six editable fields override independently without changing the original calculation',()=>{
    const base=V.calculateOptimalSettings(102,54.7,323,null,'육성사',32,[]);
    const overrides={f500_1:{t:23,min:20},f500_2:{t:25,min:22},f800_1:{t:28},f800_2:{t:31}};
    const set=V.calculateOptimalSettings(102,54.7,323,null,'육성사',32,[],overrides);
    assert.deepEqual([set.f500_1.t,set.f500_2.t,set.f800_1.t,set.f800_2.t],[23,25,28,31]);
    assert.equal(set.f500_1.min,20);assert.equal(set.f500_2.min,22);assert.equal(set.f500_1.diff,base.f500_1.diff);
    assert.equal(base.f500_1.t,24);assert.equal(base.hasManualOverrides,false);
    assert.equal(set.minSuppliedCMH,(base.caps.c1*20+base.caps.c2*22)/100);
    assert.equal(set.minVel,set.minSuppliedCMH/3600/base.crossSectionArea);
    assert.equal(V.calculateOptimalSettings(102,54.7,323,null,'육성사',32,[],null).f500_1.t,24);
});
test('invalid stored overrides are ignored; zero minimum is preserved; unsupported fields cannot change',()=>{
    const x=V.calculateOptimalSettings(102,54.7,323,null,'육성사',32,[],{f500_1:{t:'23',min:0,diff:99},f500_2:{t:NaN,min:101},f800_1:{min:101}});
    assert.equal(x.f500_1.t,24);assert.equal(x.f500_1.min,0);assert.equal(x.f500_1.diff,4);
    assert.equal(x.f500_2.min,26);assert.equal(x.f800_1.min,0);
    const nursery=V.calculateOptimalSettings(40,15,100,null,'이유사',null,[],{f500_2:{t:30,min:100}});
    assert.equal(nursery.f500_2.t,0);assert.equal(nursery.f500_2.min,0);
});
test('the livestock app mapping returns the same shared overrides as the ventilation app',()=>{
    const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
    const code=html.slice(html.indexOf('    function getStandaloneVentSettings('),html.indexOf('    // Firebase Timestamp'));
    const context=vm.createContext({ventilationSource:V,document:{createElement:()=>({innerHTML:'',textContent:''})}});
    vm.runInContext(code,context);
    const overrides={f500_1:{t:23,min:19},f500_2:{t:22,min:21},f800_1:{t:27},f800_2:{t:30}};
    const result=context.getStandaloneVentSettings(102,54.7,323,'육성사',32,overrides,[]);
    assert.deepEqual([result.t1,result.t2,result.t3,result.t4,result.min1,result.min2],[23,22,27,30,19,21]);
    assert.equal(result.hasManualOverrides,true);
});

test('group editor saves ventilation and deviations shared with calculations',()=>{
 const x=V.calculateOptimalSettings(102,54.7,323,null,'육성사',32,[],{f500_1:{diff:5},f500_2:{diff:6},f800_1:{min:10,diff:4},f800_2:{max:80,diff:3}});
 assert.deepEqual([x.f500_1.diff,x.f500_2.diff,x.f800_1.diff,x.f800_2.diff],[5,6,4,3]);
 assert.equal(x.f800_2.max,80);
 assert.equal(x.minSuppliedCMH,(x.caps.c1*x.f500_1.min+x.caps.c2*x.f500_2.min+x.caps.c3*10)/100);
});
