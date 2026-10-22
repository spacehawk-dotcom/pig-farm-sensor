const test = require('node:test');
const assert = require('node:assert/strict');
require('../ventilation.js');
const V = globalThis.FarmVentilation;
const record = require('../ventilation-setting-record.js');
const calculate = (overrides, weight = 80, count = 300, room = '육성사') =>
    V.calculateOptimalSettings(130, weight, count, null, room, null, [], overrides);

test('default 0.4 and seasonal coefficients determine requirements and rounded recommendations', () => {
    for (const coefficient of [undefined, 0.2, 0.5, 1, 1.2]) {
        const opt = calculate({coefficient});
        const required = 80 * 300 * (coefficient ?? 0.4);
        const rate = Math.ceil(required / (6960 * 5) * 100);
        assert.equal(opt.minRequiredCMH, required);
        assert.equal(opt.recommendedMinimum.f500_1.rate, rate);
        assert.equal(opt.recommendedMinimum.f500_2.rate, rate);
        assert.equal(opt.recommendedMinimum.f500_1.cmh, 6960 * 2 * rate / 100);
        assert.equal(opt.recommendedMinimum.f500_2.cmh, 6960 * 3 * rate / 100);
    }
});

test('saved group inputs do not replace independent recommendations', () => {
    const opt = calculate({coefficient:0.4, f500_1:{min:35}, f500_2:{min:40}});
    assert.equal(opt.f500_1.min,35);
    assert.equal(opt.f500_2.min,40);
    assert.equal(opt.recommendedMinimum.f500_1.rate,28);
    assert.equal(opt.recommendedMinimum.f500_2.rate,28);
});

test('volume floor, weaning groups and maximum capacity still apply', () => {
    const low = calculate({coefficient:0.2}, 7, 10);
    assert.equal(low.minRequiredCMH,low.volume*1.5);
    const weaning = calculate({coefficient:0.4}, 15, 100, '이유사');
    assert.equal(weaning.recommendedMinimum.f500_2.rate,0);
    assert.equal(weaning.recommendedMinimum.f500_2.cmh,0);
    const high = calculate({coefficient:10},110,400);
    assert.equal(high.recommendedMinimum.f500_1.rate,100);
    assert.ok(high.minShortfallCMH>0);
    for(const coefficient of [NaN,0,-1,Infinity,'1',11]) assert.equal(calculate({coefficient}).coefficient,0.4);
});

test('setting records use saved or newly edited coefficients and retain group values', () => {
    const input={id:'example',batchId:'batch_1',type:'육성사',data:{age:130,pigs:300,ventilationOverrides:{coefficient:0.2,f500_1:{min:35}}},updates:{},context:'',now:1000};
    assert.equal(record.build(input,V).coefficient,0.2);
    const next=record.build({...input,updates:{'ventilationOverrides.coefficient':1.2}},V);
    assert.equal(next.coefficient,1.2);
    assert.equal(next.groups[0].min,35);
    assert.ok(record.valid(next));
    assert.throws(()=>record.build({...input,updates:{'ventilationOverrides.coefficient':0}},V));
});
