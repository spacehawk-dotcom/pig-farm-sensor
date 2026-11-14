const {normalize}=require('../../../feeder-core.js');
const fail=message=>Object.assign(new Error(message),{status:400});
const REPORT_PATH='winch_server_locks/feeder_monitor_report';
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
    for(const row of incoming){if(!map.has(row.deviceId)||map.get(row.deviceId).measuredAt<=row.measuredAt)map.set(row.deviceId,row);}
    tx.set(ref,{receivedAt:now,rows:[...map.values()].sort((a,b)=>a.deviceId-b.deviceId)});
  });
  return {accepted:incoming.length};
}
async function readReport(db){const result=(await db.doc(REPORT_PATH).get()).data();return result?{receivedAt:result.receivedAt,rows:result.rows||[]}:{receivedAt:null,rows:[]};}
module.exports={validateReport,acceptReport,readReport,REPORT_PATH};
