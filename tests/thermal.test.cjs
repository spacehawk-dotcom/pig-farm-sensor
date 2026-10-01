const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const T = require('../thermal-core.js');
const base = { temp: 28, humidity: 70, speed: 0.2, weight: 60, stage: 'finisher' };
// Published Stull worked example: 20C / 50% RH gives 13.7C wet bulb.
assert(Math.abs(T.wetBulb(20, 50) - 13.7) < 0.1);
assert(Math.abs(T.estimate({ ...base, temp: 24, humidity: 50 }).et - 24) < 0.3);
// Bjerg's group-pig example: +.87m/s at 28C lowers ET approximately 4C.
assert(Math.abs(T.estimate(base).et - T.estimate({ ...base, speed: 1.07 }).et - 4) < 0.03);
assert(T.estimate({ ...base, humidity: 90 }).et > T.estimate({ ...base, humidity: 50 }).et);
assert.equal(T.estimate(base).et, T.estimate({ ...base, weight: 90 }).et);
for (const field of ['temp', 'humidity', 'speed', 'weight']) {
    for (const value of ['', null, undefined, NaN, Infinity, true]) assert(T.estimate({ ...base, [field]: value }).error, field + ':' + value);
}
for (const patch of [{ temp: 19.9 }, { temp: 28.1 }, { humidity: 0 }, { humidity: 100 }, { speed: 0 }, { speed: 1.31 }, { weight: 20 }, { stage: 'other' }, { stage: '' }]) assert(T.estimate({ ...base, ...patch }).error);
assert(!T.estimate({ ...base, temp: 20, humidity: 5, speed: 1.3 }).error);
assert.equal(T.reference(''), null);
assert.equal(T.reference(4), null);
assert.equal(T.reference(30 * 0.45359237).label, '자돈 30~50lb');
assert.equal(T.reference(50 * 0.45359237).low, 10);
const raw = [{ time: 1, data: { a: { temp: 24, humi: 70 } } }, { time: 2, data: { a: { temp: 25 } } }, { time: 3, data: { a: { temp: 26, humi: 720 } } }];
assert.equal(T.latest(raw, 'a', { start: 1, end: 2 }).humidity, null, 'never mix older humidity with latest temperature');
assert.equal(T.latest(raw, 'a', { start: 1, end: 3 }).humidity, 72);
assert.equal(T.latest(raw, 'missing', { start: 1, end: 3 }), null);
assert.equal(T.latest(raw, 'a', { start: 4, end: 5 }), null);
// Exercise rendering and clearing to ensure invalid input cannot retain an old ET.
const ids = ['pigWeight','etTemp','etHumidity','etSpeed','etStage','etFloor','etFloorWet','etValue','etResult','etReference','etFloorNote','etSource','etReset'];
const elements = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', checked: false, events: {}, addEventListener(name, handler) { this.events[name] = handler; } }]));
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../thermal-ui.js'), 'utf8'), { window: { PigThermal: T }, document: { getElementById: id => elements[id] }, Date });
for (const [id, value] of Object.entries({ pigWeight: '60', etTemp: '28', etHumidity: '70', etSpeed: '1.07', etStage: 'finisher' })) elements[id].value = value;
elements.etSpeed.events.input();
assert.match(elements.etValue.textContent, /℃/);
const before = elements.etValue.textContent;
elements.etFloorWet.checked = true;
elements.etFloorWet.events.change();
assert.equal(elements.etValue.textContent, before, 'floor observation must not fabricate a temperature correction');
elements.etSpeed.value = '';
elements.etSpeed.events.input();
assert.equal(elements.etValue.textContent, '—');
elements.etReset.events.click();
assert.equal(elements.etStage.value, '');
assert.equal(elements.etFloorWet.checked, false);
console.log('Thermal model, source pairing, bounds and UI clearing checks passed.');
