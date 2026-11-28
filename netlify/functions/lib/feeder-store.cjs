const {normalize,koreanDay}=require('../../../feeder-core.js');
const fail=message=>Object.assign(new Error(message),{status:400});
const REPORT_PATH='winch_server_locks/feeder_monitor_report';
const HISTORY_PATH=REPORT_PATH+'/daily';
const PAGE_SIZE=120;
function sessionFor(row,kind){
  return {id:`${row.deviceId}_${row.measuredAt}`,deviceId:row.deviceId,sowId:row.sowId,startedAt:row.measuredAt,startKind:kind};
}
function recordDay(entries,session,row){
  const prior=entries[session.id];
  if(prior&&prior.measuredAt>=row.measuredAt)return;
  // Each KOCA amount is a daily counter, not an incremental meal amount.
  entries[session.id]={deviceId:row.deviceId,sowId:row.sowId,target:row.target,amount:row.amount,
    measuredAt:row.measuredAt,firstMeasuredAt:prior?.firstMeasuredAt??row.measuredAt,
    counterReset:!!prior?.counterReset||!!prior&&row.amount<prior.amount,
    targetChanged:!!prior?.targetChanged||!!prior&&row.target!==prior.target};
}
function validateReport(body,now=Date.now()){
  if(!body||!Array.isArray(body.rows)||body.rows.length>72)throw fail('Invalid feeder report');
  const rows=body.rows.map(normalize),ids=new Set();
  for(const row of rows){if(ids.has(row.deviceId)||row.measuredAt>now+60000)throw fail('Invalid feeder record');ids.add(row.deviceId);}
  return rows;
}
async function acceptReport(db,body,now=Date.now()){
  const incoming=validateReport(body,now),ref=db.doc(REPORT_PATH);
  // Merge by source time so retrying an older report cannot roll a feeder back.
  await db.runTransaction(async tx=>{
    const old=(await tx.get(ref)).data()||{},map=new Map((old.rows||[]).map(r=>[r.deviceId,r]));
    const sessions={...old.sessions},updates=[];
    // Migrate the last known records without inventing their original entry dates.
    for(const row of map.values()){
      if(row.active&&!sessions[row.deviceId]){
        sessions[row.deviceId]=sessionFor(row,'first-observed');
        updates.push({session:sessions[row.deviceId],row});
      }
    }
    for(const row of incoming){
      const previous=map.get(row.deviceId);
      if(previous&&row.measuredAt<=previous.measuredAt)continue;
      if(!row.active)delete sessions[row.deviceId];
      else{
        if(!sessions[row.deviceId]||previous?.sowId!==row.sowId){
          sessions[row.deviceId]=sessionFor(row,previous?'entry-observed':'first-observed');
        }
        updates.push({session:sessions[row.deviceId],row});
      }
      map.set(row.deviceId,row);
    }
    const days=[...new Set(updates.map(({row})=>koreanDay(row.measuredAt)))];
    // All transaction reads precede writes. One shared daily document avoids 72 writes per report.
    const snapshots=await Promise.all(days.map(day=>tx.get(db.doc(`${HISTORY_PATH}/${day}`))));
    days.forEach((day,i)=>{
      const entries={...(snapshots[i].data()?.entries||{})};
      for(const update of updates)if(koreanDay(update.row.measuredAt)===day)recordDay(entries,update.session,update.row);
      tx.set(db.doc(`${HISTORY_PATH}/${day}`),{day,entries});
    });
    tx.set(ref,{receivedAt:now,rows:[...map.values()].sort((a,b)=>a.deviceId-b.deviceId),sessions});
  });
  return {accepted:incoming.length};
}
async function readReport(db){const result=(await db.doc(REPORT_PATH).get()).data();return result?{receivedAt:result.receivedAt,rows:result.rows||[],sessions:result.sessions||{}}:{receivedAt:null,rows:[],sessions:{}};}
async function readHistory(db,{deviceId,sowId,sessionId,cursor},now=Date.now()){
  const id=Number(deviceId);
  if(!/^\d{1,2}$/.test(String(deviceId))||id<1||id>72||sowId?.length>80)throw fail('Invalid history request');
  const report=(await db.doc(REPORT_PATH).get()).data()||{},current=report.rows?.find(r=>r.deviceId===id);
  if(sowId&&current?.sowId!==sowId)throw Object.assign(new Error('Occupant changed'),{status:409});
  if(!current?.active)return {deviceId:id,current:current||null,session:null,days:[],nextCursor:null};
  const session=report.sessions?.[id]||sessionFor(current,'first-observed');
  if(sessionId&&sessionId!==session.id)throw Object.assign(new Error('Occupant changed'),{status:409});
  const start=koreanDay(session.startedAt),end=koreanDay(now);
  if(cursor&&(!/^\d{4}-\d{2}-\d{2}$/.test(cursor)||cursor<start||cursor>end))throw fail('Invalid history cursor');
  let query=db.collection(HISTORY_PATH).orderBy('__name__');
  query=cursor?query.startAfter(cursor):query.startAt(start);
  const snapshot=await query.endAt(end).limit(PAGE_SIZE).get();
  const days=snapshot.docs.flatMap(doc=>{
    const entry=doc.data().entries?.[session.id];
    return entry&&entry.sowId===session.sowId&&entry.deviceId===id?[{day:doc.id,...entry}]:[];
  });
  const nextCursor=snapshot.docs.length===PAGE_SIZE?snapshot.docs.at(-1).id:null;
  if(!nextCursor){
    const day=koreanDay(current.measuredAt),last=days.find(d=>d.day===day);
    if(!last&&(!cursor||day>cursor))days.push({day,...current,firstMeasuredAt:current.measuredAt,counterReset:false,targetChanged:false});
  }
  return {deviceId:id,current,session,days,nextCursor,receivedAt:report.receivedAt||null};
}
module.exports={validateReport,acceptReport,readReport,readHistory,recordDay,REPORT_PATH,HISTORY_PATH};
