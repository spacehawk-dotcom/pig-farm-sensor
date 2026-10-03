const test = require('node:test');
const assert = require('node:assert/strict');
require('../ventilation.js');
const { calculateOptimalSettings: calculate } = globalThis.FarmVentilation;

test('예측 체중은 110kg 상한이며 180일 경계에서 하락하지 않고 시뮬레이터와 일치한다', () => {
    const { calculateWeight } = globalThis.FarmVentilation;
    const { estimatedWeight } = require('../simulation-core.js');
    let previous = 0;
    for (let age = 1; age <= 400; age++) {
        const weight = calculateWeight(age);
        assert.ok(weight >= previous && weight <= 110, `age ${age}`);
        assert.equal(weight, estimatedWeight(age), `same prediction at age ${age}`);
        previous = weight;
    }
    for (const age of [180, 181, 191, 338]) assert.equal(calculateWeight(age), 110);
    const batch3 = calculate(191, calculateWeight(191), 175, null, '육성사');
    const batch6 = calculate(338, calculateWeight(338), 89, null, '육성사');
    assert.equal(batch3.minRequiredCMH, 9625);
    assert.equal(batch3.f500_1.min, 28);
    assert.equal(batch6.minRequiredCMH, 4895);
    assert.equal(batch6.f500_1.min, 15);
});

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
    assert.equal(calculate(updated.age, 40, 300, null, '육성사', updated.stockDiffDays).f500_1.t, 26);
    assert.equal(calculatePigAge({ ...batch, growerInDate: '' }, '육성사').stockDiffDays, null);
    assert.deepEqual(calculatePigAge({ ...batch, growerInDate: format(entered) }, '이유사'), calculatePigAge(batch, '이유사'));
});

test('육성사 입식 3일차와 6일차를 각 보정 기간에 포함한다', () => {
    for (const [day, expected] of [[0, 26], [1, 26], [2, 26], [3, 26], [4, 25], [5, 25], [6, 25], [7, 24], [30, 24]]) {
        const result = calculate(76, 34.6, 307, null, '육성사', day, [26.1, 18.8]);
        assert.deepEqual(
            [result.f500_1.t, result.f500_2.t, result.f800_1.t, result.f800_2.t],
            [expected, expected, expected + 2, expected + 5],
            `입식 ${day}일차`
        );
        if (day === 6) assert.match(result.historyMsg, /입식 적응 온도 보상 \(\+1℃\)/);
        if (day === 7) assert.match(result.historyMsg, /입식 적응 완료/);
    }
});

test('외기 최고 30℃ 이상·최저 20℃ 이하에서도 온도를 올리지 않고 입식 보정만 유지한다', () => {
    const result = calculate(76, 34.6, 307, null, '육성사', 6, [30, 20]);
    assert.equal(result.f500_1.t, 25);
    for (const outdoor of [[30, 20], [30.9, 13.2], [35, 10], [28, 20], []]) {
        const settled = calculate(102, 54.7, 323, null, '육성사', 32, outdoor);
        assert.deepEqual([settled.f500_1.t, settled.f500_2.t, settled.f800_1.t, settled.f800_2.t], [24, 24, 26, 29]);
    }
});

test('입식일이 없거나 이유사인 경우 육성사 보정을 적용하지 않는다', () => {
    assert.equal(calculate(76, 34.6, 307, null, '육성사', null).f500_1.t, 24);
    for (const day of [0, 3, 4, 6, 7]) {
        assert.equal(
            calculate(40, 15, 200, null, '이유사', day).f500_1.t,
            calculate(40, 15, 200, null, '이유사', null).f500_1.t
        );
    }
});
