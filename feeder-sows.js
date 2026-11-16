/* Read-only sow metadata shared with the livestock overview. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FeederSows=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const key=value=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
  // KOCA's year prefix identifies gilt entry year; sow identity is the number after it.
  function sowKey(value){
    const text=key(value),m=text.match(/^(?:\d+-)?(\d+)$/);
    return m?m[1].replace(/^0+(?=\d)/,''):text;
  }
  function parity(value){
    if(!/^\d+$/.test(key(value)))return null;
    const n=Number(value);return Number.isSafeInteger(n)?n:null;
  }
  function farrowingDate(value){
    const s=key(value),m=s.match(/^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/);
    if(!m)return null;
    const year=m[1]?Number(m[1]):2000,month=Number(m[2]),day=Number(m[3]);
    const date=new Date(Date.UTC(year,month-1,day));
    if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
    const short=`${String(month).padStart(2,'0')}/${String(day).padStart(2,'0')}`;
    return {short,full:m[1]?`${m[1]}/${short}`:short};
  }
  function index(records){
    const result=new Map(),groups=new Map();
    for(const sow of records){
      const id=sowKey(sow?.sowNo);if(!id)continue;
      const group=groups.get(id)||[];group.push(sow);groups.set(id,group);
    }
    for(const [id,group] of groups){
      const nursing=group.filter(s=>['포유','mammal','suckling','lactation','nursing'].includes(key(s.currentStatus).toLowerCase()));
      const mothers=group.filter(s=>parity(s.parity)>0);
      const candidates=nursing.length?nursing:mothers.length?mothers:group;
      if(candidates.length!==1){result.set(id,{duplicate:true});continue;}
      const sow=candidates[0];
      const p=parity(sow.parity);
      const current=p!==null&&Array.isArray(sow.history)?sow.history.filter(h=>h&&parity(h.parity)===p):[];
      const readDate=field=>{
        const dates=current.map(h=>key(h[field])).filter(Boolean).map(farrowingDate);
        const valid=dates.filter(Boolean),distinct=new Set(valid.map(d=>d.full));
        const issue=dates.some(d=>!d)||distinct.size>1;
        return {date:!issue&&valid.length?valid[0]:null,issue};
      };
      const birth=p>0?readDate('date'):{date:null,issue:false},expected=readDate('expDate');
      result.set(id,{parity:p,date:birth.date,dateIssue:birth.issue,expectedDate:expected.date,expectedIssue:expected.issue});
    }
    return result;
  }
  function labels(records,sowId,status='ready',detail=false){
    const item=records.get(sowKey(sowId));
    if(item?.duplicate)return {parity:'확인 필요',date:'확인 필요',expected:'확인 필요'};
    const absent=status==='loading'?'연결 중':status==='error'||status==='cache'?'연결 확인':'미등록';
    return {parity:item?.parity!=null?`${item.parity}산`:absent,date:item?.dateIssue?'확인 필요':item?.date?(detail?item.date.full:item.date.short):absent,expected:item?.expectedIssue?'확인 필요':item?.expectedDate?(detail?item.expectedDate.full:item.expectedDate.short):absent};
  }
  function subscribe(onChange){
    let stopped=false,stopAuth,stopSnapshot;
    const emit=(status,records)=>{if(!stopped)onChange({status,records});};
    const timer=setTimeout(()=>emit('error'),15000);
    const load=src=>new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);
    });
    (async()=>{
      for(const name of ['app','auth','firestore']){
        if(stopped)return;
        await load(`https://www.gstatic.com/firebasejs/10.7.1/firebase-${name}-compat.js`);
      }
      if(stopped)return;
      const firebase=window.firebase;
      const app=firebase.apps.length?firebase.app():firebase.initializeApp({
        apiKey:'AIzaSyBlptGu2gTAQKVy_yDomKkNEd_el6c1PL0',
        authDomain:'sungamfarm.firebaseapp.com',projectId:'sungamfarm',
        appId:'1:811107235779:web:ea65a74d09c37ba2136f76'
      });
      stopAuth=app.auth().onAuthStateChanged(user=>{
        stopSnapshot?.();stopSnapshot=null;
        if(stopped)return;
        if(!user){app.auth().signInAnonymously().catch(()=>{clearTimeout(timer);emit('error');});return;}
        stopSnapshot=app.firestore().collection('farms/sungamfarm/sows').onSnapshot({includeMetadataChanges:true},snapshot=>{
          clearTimeout(timer);
          emit(snapshot.metadata.fromCache?'cache':'ready',index(snapshot.docs.map(doc=>doc.data())));
        },()=>{clearTimeout(timer);emit('error');});
      },()=>{clearTimeout(timer);emit('error');});
    })().catch(()=>{clearTimeout(timer);emit('error');});
    return ()=>{stopped=true;clearTimeout(timer);stopAuth?.();stopSnapshot?.();};
  }
  return {index,labels,farrowingDate,sowKey,subscribe};
});
