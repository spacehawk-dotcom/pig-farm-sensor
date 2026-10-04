(function(root){
 const DAY=86400000;
 function count(b){for(const key of ['pigs','count','currentCount','totalPigs'])if(b?.[key]!=null && b[key]!=='')return Number(b[key]);return NaN;}
 function room(b,id){const n=Number(String(b?.name||b?.batchName||b?.roomName||id).match(/\d+/)?.[0]);return n>=1&&n<=7?`육성_${n}배치`:null;}
 function start(b){const value=b?.growerInDate ?? b?.date ?? b?.stockDate; if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null; const n=Date.parse(value+'T00:00:00+09:00');return Number.isFinite(n)?n:null;}
 function identity(room,start){return encodeURIComponent(room)+'_'+start;}
 function inCycle(record,cycle){return record.room===cycle.room && record.start>=cycle.start && record.end<=(cycle.end??Infinity) && (!record.cycleId || record.cycleId===cycle.id);}
 function stats(samples,record){const points=samples.filter(p=>p.time>=record.start&&p.time<=record.end&&Number.isFinite(p.inside)).sort((a,b)=>a.time-b.time);if(!points.length)return null;return {count:points.length,min:Math.min(...points.map(p=>p.inside)),max:Math.max(...points.map(p=>p.inside)),change:points.at(-1).inside-points[0].inside,gaps:points.some((p,i)=>i&&p.time-points[i-1].time>1800000)};}
 const api={DAY,count,room,start,identity,inCycle,stats};if(typeof module!=='undefined')module.exports=api;else root.VentilationCycles=api;
})(typeof window==='undefined'?globalThis:window);
