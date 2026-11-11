// HA owns temperature decisions after an explicit, durable per-batch handover.
// Server schedules never take ownership back merely because HA is disconnected.
function createHaOwner({legacy,store,control,withLock,readSettings,readReport,readMailbox,env,registry}){
  const owned=async id=>(await store.read(id))?.owner==='ha';
  const status=async id=>{
    const saved=await legacy.status(id);
    if(saved.owner!=='ha')return saved;
    const [report,message]=await Promise.all([readReport(),readMailbox(id)]);
    const live=report?.autos?.[id];
    const latest=message?.auto?.checkedAt>(live?.checkedAt||0)?message.auto:live;
    return {...saved,...latest,owner:'ha'};
  };
  const probe=async id=>{
    if(!await owned(id))return legacy.probe(id);
    const auto=await status(id),result={auto};
    const report=await readReport(),sample=report?.temperatures?.[id];
    if(Number.isFinite(sample?.temperature)&&Number.isFinite(sample?.measuredAt)&&
       Date.now()-sample.measuredAt<900000 && sample.measuredAt<=Date.now()+30000)result.sample=sample;
    else result.sensorError='HA 온도 센서의 최신 수신을 기다리고 있습니다.';
    try{result.settings=await readSettings(id);}catch(e){result.settingsError=e.message;}
    return result;
  };
  const manual=async(action,id)=>{
    if(!await owned(id))return legacy.manual(action,id);
    return withLock(action,()=>control.move(action,id),id);
  };
  const enable=async id=>{
    if(!await owned(id))return legacy.enable(id);
    return withLock('auto_on',async()=>control.move('resume',id,{settings:await readSettings(id)}),id);
  };
  const configure=async ids=>{
    const batches={};
    await Promise.all(ids.map(async id=>{
      if(!Object.hasOwn(registry,id))return;
      const allowed=env[registry[id].enabledEnv]==='true';
      try{
        let settings=null;
        try{settings=await readSettings(id);}catch{ /* Manual control does not require an automatic setpoint. */ }
        batches[id]=await withLock('handover',async()=>{
          const initial=await legacy.status(id);
          const message=await readMailbox(id);
          if(initial.owner!=='ha' && message && message.phase!=='done' && message.expires+3500>Date.now())
            throw Error('previous command pending');
          if(initial.owner!=='ha')await store.write(id,{...initial,owner:'ha',handedOverAt:Date.now()});
          return {allowed,settings,initial:{enabled:initial.enabled,paused:initial.paused}};
        },id);
      }catch(e){batches[id]={allowed:false,error:'설정 동기화 대기'};}
    }));
    return {batches};
  };
  return {status,probe,manual,enable,tick:legacy.tick,configure};
}
module.exports={createHaOwner};
