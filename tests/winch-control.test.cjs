const test=require('node:test');
const assert=require('node:assert/strict');
const {createHandler,SAFETY}=require('../netlify/functions/lib/winch-control');
function fixture(overrides={}){
  const calls=[];
  let values={switch_2:false,switch_3:false,...SAFETY,...overrides};
  const env={WINCH_CONTROL_PASSWORD:'Abcde12345',WINCH_SAFETY_CONFIRMED:'true'};
  const handler=createHandler({env,sleep:async()=>{},withLock:async(_,fn)=>fn(),request:async(method,path,body)=>{
    calls.push({method,path,body});
    if(method==='GET')return {online:true,status:Object.entries(values).map(([code,value])=>({code,value}))};
    body.commands.forEach(c=>values[c.code]=c.value);return true;
  }});
  const send=(action,password=env.WINCH_CONTROL_PASSWORD)=>handler({httpMethod:'POST',headers:{'x-winch-password':password},body:JSON.stringify({action})});
  return {calls,send,env};
}
test('unauthorized requests never contact device',async()=>{const f=fixture();assert.equal((await f.send('up','wrong')).statusCode,401);assert.equal(f.calls.length,0);});
test('password policy accepts ten mixed characters and rejects weak configuration',async()=>{
  const valid=fixture();assert.equal((await valid.send('status')).statusCode,200);
  for(const password of ['Abcd12345','abcdefghij','1234567890','']){
    const f=fixture();f.env.WINCH_CONTROL_PASSWORD=password;
    assert.equal((await f.send('status')).statusCode,503);assert.equal(f.calls.length,0);
  }
});
test('up/down use confirmed Tuya channels after OFF and status check',async()=>{
  for(const [action,channel] of [['up','switch_3'],['down','switch_2']]){
    const f=fixture();assert.equal((await f.send(action)).statusCode,200);
    assert.deepEqual(f.calls.map(c=>c.method),['GET','POST','GET','POST']);
    assert.deepEqual(f.calls[1].body.commands,[{code:'switch_2',value:false},{code:'switch_3',value:false}]);
    assert.deepEqual(f.calls[3].body.commands,[{code:channel,value:true}]);
  }
});
test('changed safety or moving relay blocks movement',async()=>{for(const value of [{switch_interlock:'different'},{switch_inching:''},{switch_2:true}]){const f=fixture(value);assert.equal((await f.send('up')).statusCode,409);assert(!f.calls.some(c=>c.method==='POST'));}});
test('disabled commissioning blocks movement but permits stop',async()=>{const f=fixture();f.env.WINCH_SAFETY_CONFIRMED='false';assert.equal((await f.send('down')).statusCode,409);assert.equal((await f.send('stop')).statusCode,200);assert(f.calls.filter(c=>c.method==='POST').every(c=>c.body.commands.every(x=>x.value===false)));});
test('invalid action never contacts device',async()=>{const f=fixture();assert.equal((await f.send('all_on')).statusCode,400);assert.equal(f.calls.length,0);});
