const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {onValueCreated}=require('firebase-functions/v2/database');
const admin=require('firebase-admin');
const C=require('./cycle-core');
admin.initializeApp();const db=admin.firestore();
const base='farms/sungamfarm';
// Use event timestamps, not delivery time. Transaction locks one room across retries.
exports.trackGrowerCycle=onDocumentWritten({document:base+'/grower/{batchId}',region:'us-central1',retry:true},async event=>{
 const before=event.data.before.data(),after=event.data.after.data();
 if(!after)return; // Deletion is not evidence of zero animals.
 const room=C.room(after,event.params.batchId),n=C.count(after),at=event.data.after.updateTime?.toMillis()??Date.parse(event.time);
 if(!room||!Number.isInteger(n)||n<0)return;
 const stateRef=db.doc(base+'/ventilation_cycle_state/'+encodeURIComponent(room));
 await db.runTransaction(async tx=>{
  const state=(await tx.get(stateRef)).data()||{};
  if(state.eventTime>=at) {
   // A delayed zero event must still close its previous stocking cycle.
   if(n===0 && C.count(before)>0) {
    const st=C.start(before);
    if(st!==null) {
     const all=await tx.get(db.collection(base+'/ventilation_cycles').where('room','==',room));
     const matches=all.docs.filter(d=>d.data().start===st && (d.data().end==null||d.data().end===at) && (d.data().createdAt??0)<=at);
     if(matches.length===1)tx.set(matches[0].ref,{end:at,status:'closed',lastCount:0,endBasis:'두수 0 변경 시각'},{merge:true});
     else if(!all.docs.some(d=>d.data().start===st&&d.data().end===at)) {
      const recoveredId=C.identity(room,st)+'_closed_'+at;
      tx.set(db.doc(base+'/ventilation_cycles/'+recoveredId),{id:recoveredId,room,start:st,end:at,status:'closed',lastCount:0,batchId:event.params.batchId,startBasis:'입식일',endBasis:'두수 0 변경 시각',createdAt:at});
     }
    }
   }
   return;
  }
  const existing=state.activeId?await tx.get(db.doc(base+'/ventilation_cycles/'+state.activeId)):null;
  let cycle=existing?.data(),id=state.activeId;
  const previousCycle = cycle && n>0 && C.count(before)===0 ? {...cycle,id} : null;
  if(previousCycle){cycle=null;id=null;}
  if(!cycle&&n===0&&C.count(before)>0){const st=C.start(before);if(st!==null){id=C.identity(room,st);cycle={id,room,start:st,batchId:event.params.batchId,startBasis:'입식일',createdAt:at};}}
  if(!cycle&&n>0){const st=C.start(after);if(st===null||st>at)return;id=C.identity(room,st);const old=await tx.get(db.doc(base+'/ventilation_cycles/'+id));if(old.exists&&(old.data().end!==null||previousCycle))id+='_'+at;cycle={id,room,start:st,end:null,batchId:event.params.batchId,startBasis:'입식일',createdAt:at};}
  if(previousCycle)tx.set(db.doc(base+'/ventilation_cycles/'+previousCycle.id),{status:'closure_pending'},{merge:true});
  if(cycle){
   const end=n===0?at:null;
   tx.set(db.doc(base+'/ventilation_cycles/'+id),{...cycle,end,status:n===0?'closed':'active',lastCount:n,lastEventTime:at,endBasis:n===0?'두수 0 변경 시각':null},{merge:true});
   tx.set(db.doc(base+'/ventilation_cycles/'+id+'/settings/'+String(at)),{time:at,count:n,source:'app_shared_overrides',overrides:after.ventilationOverrides||{},note:'앱 공유 수정값이며 실제 컨트롤러 확인값이 아님'});
  }
  tx.set(stateRef,{activeId:n===0?null:id||null,eventTime:at,room});
 });
});
// Initialize already occupied rooms on the first sensor event after deployment.
async function seedOccupiedRooms() {
 const rooms=await db.collection(base+'/grower').get();
 for(const d of rooms.docs){const b=d.data(),room=C.room(b,d.id),start=C.start(b),n=C.count(b);
  if(!room||start===null||start>Date.now()||!Number.isInteger(n)||n<=0)continue;
  const stateRef=db.doc(base+'/ventilation_cycle_state/'+encodeURIComponent(room));
  await db.runTransaction(async tx=>{
   if((await tx.get(stateRef)).exists)return;
   const id=C.identity(room,start),cycleRef=db.doc(base+'/ventilation_cycles/'+id),old=await tx.get(cycleRef);
   if(old.exists && old.data().end!==null)return;
   if(!old.exists)tx.set(cycleRef,{id,room,start,end:null,status:'active',batchId:d.id,lastCount:n,startBasis:'입식일',createdAt:Date.now()});
   tx.set(stateRef,{activeId:id,room,eventTime:0});
  });
 }
}
// Archive immutable temperature samples. A whole KST day stays below Firestore's document limit.
exports.archiveCycleTemperature=onValueCreated({ref:'/history_logs/{sampleId}',instance:'sungamfarm-default-rtdb',region:'us-central1',retry:true},async event=>{
 const time=Number(event.params.sampleId),data=event.data.val();if(!Number.isFinite(time))return;
 await seedOccupiedRooms();
 const cycles=await db.collection(base+'/ventilation_cycles').get();
 const writes=[];
 for(const d of cycles.docs){const c=d.data();if(time<c.start||time>(c.end??Infinity))continue;
  const raw=data?.[c.room]?.temp;if(raw===null||raw===undefined||raw==='')continue;
  const inside=Number(raw);if(!Number.isFinite(inside))continue;
  const out=data?.['외부온도']?.temp,outside=out!==null&&out!==undefined&&out!==''&&Number.isFinite(Number(out))?Number(out):null;
  const day=new Date(time+9*3600000).toISOString().slice(0,10);
  writes.push(d.ref.collection('temperature_days').doc(day).set({day,samples:{[String(time)]:{time,inside,outside}}},{merge:true}));
 }
 await Promise.all(writes);
});
