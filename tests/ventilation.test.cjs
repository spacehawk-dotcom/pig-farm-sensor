const test = require('node:test');
const assert = require('node:assert/strict');
require('../ventilation.js');
const { calculateOptimalSettings: calculate } = globalThis.FarmVentilation;

test('최소 가동률은 20% 하한 없이 요구량에 맞게 계산한다', () => {
    const grower = calculate(78, 36.2, 307, null, '육성사', 8);
    assert.equal(grower.minRequiredCMH, 5556.700000000001);
    assert.equal(grower.f500_1.min, 16);
    assert.equal(grower.f500_2.min, 16);
    assert.equal(grower.minSuppliedCMH, 5568);
    assert.equal(grower.minShortfallCMH, 0);
    const nursery = calculate(40, 15, 200, null, '이유사');
    assert.equal(nursery.f500_1.min, 11);
    assert.equal(nursery.f500_2.min, 0);
    assert.ok(nursery.minSuppliedCMH >= nursery.minRequiredCMH);
});

test('체적 기준 최소 요구량과 팬 100% 상한을 유지한다', () => {
    const small = calculate(78, 36.2, 1, null, '육성사');
    assert.equal(small.minRequiredCMH, small.volume * 1.5);
    assert.equal(small.f500_1.min, 4);
    const large = calculate(180, 115, 1000, null, '육성사');
    assert.equal(large.f500_1.min, 100);
    assert.equal(large.f500_2.min, 100);
    assert.equal(large.minShortfallCMH, 22700);
    assert.match(large.minimumStatus, /부족/);
});

test('별도 육성사 입식일을 우선 적용하고 기존 일령을 유지한다', () => {
    const { calculatePigAge } = globalThis.FarmVentilation;
    const today = new Date();
    const format = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entered = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3);
    const batch = { date: '2026-01-01', weaningDate: '2025-12-01', penDates: ['2025-12-01'] };
    const previous = calculatePigAge(batch, '육성사');
    const updated = calculatePigAge({ ...batch, growerInDate: format(entered) }, '육성사');
    assert.equal(updated.stockDiffDays, 3);
    assert.equal(updated.age, previous.age);
    assert.equal(updated.sourceMsg, previous.sourceMsg);
    assert.equal(calculate(updated.age, 40, 300, null, '육성사', updated.stockDiffDays).f500_1.t, 24);
    assert.equal(calculatePigAge({ ...batch, growerInDate: '' }, '육성사').stockDiffDays, null);
    assert.deepEqual(calculatePigAge({ ...batch, growerInDate: format(entered) }, '이유사'), calculatePigAge(batch, '이유사'));
});

test('육성사 입식 3일차와 6일차를 각 보정 기간에 포함한다', () => {
    for (const [day, expected] of [[0, 24], [1, 24], [2, 24], [3, 24], [4, 23], [5, 23], [6, 23], [7, 22], [30, 22]]) {
        const result = calculate(76, 34.6, 307, null, '육성사', day, [26.1, 18.8]);
        assert.deepEqual(
            [result.f500_1.t, result.f500_2.t, result.f800_1.t, result.f800_2.t],
            [expected, expected, expected + 4, expected + 7],
            `입식 ${day}일차`
        );
        if (day === 6) assert.match(result.historyMsg, /입식 적응 온도 보상 \(\+1℃\)/);
        if (day === 7) assert.match(result.historyMsg, /입식 적응 완료/);
    }
});

test('외기 보정은 입식 보정과 함께 반영한다', () => {
    const result = calculate(76, 34.6, 307, null, '육성사', 6, [30, 20]);
    assert.equal(result.f500_1.t, 24);
});

test('입식일이 없거나 이유사인 경우 육성사 보정을 적용하지 않는다', () => {
    assert.equal(calculate(76, 34.6, 307, null, '육성사', null).f500_1.t, 22);
    for (const day of [0, 3, 4, 6, 7]) {
        assert.equal(
            calculate(40, 15, 200, null, '이유사', day).f500_1.t,
            calculate(40, 15, 200, null, '이유사', null).f500_1.t
        );
    }
});
