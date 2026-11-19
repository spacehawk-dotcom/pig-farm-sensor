(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FeederCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TOTAL=72,STALE_MS=15*60*1000;
  const BATCH_SIZE=24;
  function batches(){
    return Array.from({length:TOTAL/BATCH_SIZE},(_,i)=>{
      const start=i*BATCH_SIZE+1,end=(i+1)*BATCH_SIZE;
      const devices=Array.from({length:BATCH_SIZE},(_,j)=>start+j);
      return {id:i+1,label:`${i+1}배치`,start,end,devices};
    });
  }
  const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  function koreanDay(time=Date.now()){return dayFormat.format(new Date(time));}
  const FEEDING_TIMES=[{label:'07:00',minute:420},{label:'11:30',minute:690},{label:'17:00',minute:1020}];
  function feedingPlan(target,measuredAt){
    const start=Date.parse(koreanDay(measuredAt)+'T00:00:00+09:00');
    return FEEDING_TIMES.map((slot,i)=>({...slot,round:i+1,at:start+slot.minute*60000,amount:target/3,cumulative:target*(i+1)/3}));
  }
  function chartHistory(history,row){
    if(!row?.active)return [];
    const points=history.filter(x=>x.deviceId===row.deviceId&&x.sowId===row.sowId&&koreanDay(x.measuredAt)===koreanDay(row.measuredAt)&&x.measuredAt<=row.measuredAt);
    return [...new Map([...points,row].map(x=>[x.measuredAt,x])).values()].sort((a,b)=>a.measuredAt-b.measuredAt);
  }
  function timestamp(value){
    if(typeof value!=='string')return NaN;
    let s=value.trim();
    if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s))s=s.replace(' ','T')+'+09:00';
    return Date.parse(s);
  }
  function normalize(raw){
    const deviceId=Number(raw.device_id??raw.deviceId);
    const sowId=String(raw.sow_id??raw.sowId??'').trim();
    const rawTarget=raw.target_amount??raw.target,rawAmount=raw.dispensed_amount??raw.amount;
    const numeric=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v));
    if(!numeric(rawTarget)||!numeric(rawAmount))throw new Error('급이량이 누락되었습니다.');
    const target=Number(rawTarget),amount=Number(rawAmount);
    const measuredAt=typeof raw.measuredAt==='number'?raw.measuredAt:timestamp(raw.update_time);
    if(!Number.isInteger(deviceId)||deviceId<1||deviceId>TOTAL||!sowId||sowId.length>80||
      !Number.isFinite(target)||!Number.isFinite(amount)||target<0||amount<0||target>1000000||amount>1000000||!Number.isFinite(measuredAt))throw new Error('급이기 데이터 형식이 올바르지 않습니다.');
    return {deviceId,sowId,target,amount,measuredAt,active:!['0','-','*'].includes(sowId),percent:target>0?Math.floor(amount/target*100):null};
  }
  function parseLog(text,deviceId){
    const rows=[],lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
    for(let i=0;i<lines.length-3;i++){
      const header=lines[i].match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*:\s*\[RESPONSE\]/);
      if(!header||lines[i+1].trim()!=='EATLOG')continue;
      const parts=lines[i+2].trim().split(/\s+/);
      if(parts.length!==16||!parts.every(x=>/^\d+$/.test(x)))continue;
      try{rows.push(normalize({device_id:deviceId,sow_id:lines[i+3].trim(),target_amount:parts[6],dispensed_amount:parts[5],update_time:header[1]}));}catch{}
    }
    return rows.sort((a,b)=>a.measuredAt-b.measuredAt);
  }
  function status(row,{archive=false,now=Date.now()}={}){
    if(!row)return 'missing';
    if(!archive&&(now-row.measuredAt>STALE_MS||row.measuredAt>now+60000||koreanDay(row.measuredAt)!==koreanDay(now)))return 'stale';
    if(!row.active)return 'empty';
    if(row.target===0)return 'unset';
    if(row.amount>=row.target)return 'complete';
    if(row.amount/row.target<0.5)return 'low';
    return 'partial';
  }
  function summary(rows,options={}){
    const result={registered:TOTAL,received:0,active:0,complete:0,low:0,partial:0,stale:0,empty:0,unset:0,missing:0,target:0,amount:0};
    const map=new Map(rows.map(row=>[row.deviceId,row]));
    for(let id=1;id<=TOTAL;id++){
      const row=map.get(id),s=status(row,{...options,deviceId:id});result[s]++;
      if(row)result.received++;
      if(row?.active&&s!=='stale'){result.active++;result.target+=row.target;result.amount+=row.amount;}
    }
    result.expected=TOTAL;
    result.percent=result.target?Math.floor(result.amount/result.target*100):0;return result;
  }
  function merge(rows,incoming){const map=new Map(rows.map(r=>[r.deviceId,r]));for(const raw of incoming){const r=normalize(raw),old=map.get(r.deviceId);if(!old||r.measuredAt>=old.measuredAt)map.set(r.deviceId,r);}return [...map.values()].sort((a,b)=>a.deviceId-b.deviceId);}
  return {TOTAL,BATCH_SIZE,batches,FEEDING_TIMES,feedingPlan,chartHistory,STALE_MS,koreanDay,timestamp,normalize,parseLog,status,summary,merge};
});
