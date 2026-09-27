const test = require('node:test');
const assert = require('node:assert/strict');
require('../ventilation.js');
const { calculateOptimalSettings: calculate } = globalThis.FarmVentilation;

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
