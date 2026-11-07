const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../gestation-week.js'),'utf8'),context);
const {currentMonday, classify} = context.window.FarmGestationWeek;

test('management week changes at Korean Monday midnight, including year boundaries',()=>{
  assert.equal(currentMonday(new Date('2026-11-08T14:59:59Z')),'2026-11-02');
  assert.equal(currentMonday(new Date('2026-11-08T15:00:00Z')),'2026-11-09');
  assert.equal(currentMonday(new Date('2027-01-01T00:00:00Z')),'2026-12-28');
});
test('Thursday representative and 115-day term classify weekly groups, not individual sows',()=>{
  for(const [week,stage] of [['2027-01-25','early'],['2027-01-18','middle'],['2026-11-30','middle'],['2026-11-23','late']]){
    assert.equal(classify(week,'2026-11-02').stage,stage);
    assert.equal(classify(week,'2026-11-08').stage,stage);
  }
  assert.equal(classify('2027-01-25','2026-11-09').stage,'middle');
  assert.equal(classify('2026-11-30','2026-11-09').stage,'late');
  assert.equal(classify('2024-03-25','2024-01-01').stage,'early');
});
