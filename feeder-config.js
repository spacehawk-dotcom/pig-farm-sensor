/* Farm operating plan. This describes planned downtime, not device control. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.FeederConfig=value;})(typeof globalThis!=='undefined'?globalThis:this,()=>({
  version:1,
  effectiveFrom:'2026-11-15T00:00:00+09:00',
  cleaningDevices:Array.from({length:24},(_,i)=>i+1),
  reason:'입식 전 청소 · 전원 꺼짐',
}));
