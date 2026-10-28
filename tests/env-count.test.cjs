const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const FarmVentilation=require('../ventilation.js');
const html=fs.readFileSync(require.resolve('../env.html'),'utf8');
const context=vm.createContext({FarmVentilation});
vm.runInContext(html.slice(html.indexOf('function extractFarmInfo('),html.indexOf('function fixHumidity(')),context);
vm.runInContext(html.slice(html.indexOf('function recordedCount('),html.indexOf('function openHistory(')),context);
test('environment summary uses occupied pen counts even if legacy total is absent or stale',()=>{
  for(const pigs of [undefined,0,999])assert.equal(context.extractFarmInfo({pigs,penDetails:[32,31,0,30]}).count,93);
  assert.equal(context.extractFarmInfo({pigs:999,penDetails:[0,0]}).count,0);
  assert.equal(context.extractFarmInfo({pigs:25}).count,25);
});
test('history distinguishes missing headcount from a recorded empty batch',()=>{
  for(const value of [null,undefined,'','bad',-1])assert.equal(context.recordedCount(value),'--');
  assert.equal(context.recordedCount(0),0);
  assert.equal(context.recordedCount('125'),125);
});
