/* Daily KOCA counters: never sum repeated snapshots or invent missing days. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FeederHistory=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  const dayTime=day=>Date.parse(day+'T00:00:00+09:00');
  function dailyPoints(records,session){
    if(!session)return [];
    const map=new Map();
    for(const row of records){
      if(row.deviceId!==session.deviceId||row.sowId!==session.sowId||row.measuredAt<session.startedAt||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.day)||!Number.isFinite(dayTime(row.day))||
        !Number.isFinite(row.amount)||!Number.isFinite(row.target)||row.amount<0||row.target<0)continue;
      const prior=map.get(row.day);
      if(!prior||row.measuredAt>=prior.measuredAt)map.set(row.day,{...row,
        counterReset:!!row.counterReset||!!prior?.counterReset||!!prior&&row.amount<prior.amount,
        targetChanged:!!row.targetChanged||!!prior?.targetChanged||!!prior&&row.target!==prior.target});
    }
    return [...map.values()].sort((a,b)=>a.day.localeCompare(b.day));
  }
  function chart(points,startDay,endDay){
    const width=760,height=300,left=60,right=24,top=28,bottom=52;
    const start=dayTime(startDay),end=Math.max(start,dayTime(endDay)),span=end-start;
    const maximum=Math.max(1000,...points.flatMap(p=>[p.amount,p.target]));
    const ceiling=Math.ceil(maximum/1000)*1000;
    const x=day=>span?left+(dayTime(day)-start)/span*(width-left-right):(left+width-right)/2;
    const y=value=>height-bottom-value/ceiling*(height-top-bottom);
    const paths=field=>{
      let previous;return points.map(p=>{const move=!previous||dayTime(p.day)-dayTime(previous.day)!==DAY;
        previous=p;return `${move?'M':'L'}${x(p.day).toFixed(2)},${y(p[field]).toFixed(2)}`;}).join(' ');
    };
    const count=Math.min(5,Math.round(span/DAY)+1),ticks=[];
    for(let i=0;i<count;i++){
      const offset=count===1?0:Math.round(i*(span/DAY)/(count-1));
      const day=new Date(start+offset*DAY+9*3600000).toISOString().slice(0,10);
      ticks.push({day,x:x(day)});
    }
    return {width,height,left,right,top,bottom,ceiling,ticks,
      grid:Array.from({length:5},(_,i)=>({value:ceiling*i/4,y:y(ceiling*i/4)})),
      targetPath:paths('target'),amountPath:paths('amount'),
      dots:points.map(p=>({...p,x:x(p.day),targetY:y(p.target),amountY:y(p.amount)}))};
  }
  return {dailyPoints,chart};
});
