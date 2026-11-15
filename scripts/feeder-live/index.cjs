/* Local subscriber only. Credentials stay in this Node process, never in HTTP. */
const fs=require('node:fs');
const C=require('../../feeder-core.js');

function readCredentials(file){
  const source=fs.readFileSync(file,'utf8');
  const read=name=>{
    const match=source.match(new RegExp('^\\s*'+name+'\\s*=\\s*(["\'])([^\\r\\n]*?)\\1\\s*(?:#.*)?$','m'));
    if(!match||!match[2]||match[2].includes('\\'))throw new Error('Collector credential literal unavailable');
    return match[2];
  };
  return {username:read('MQTT_USER'),password:read('MQTT_PASS')};
}

function parseMessage(topic,payload,now=Date.now()){
  const match=topic.match(/^farm\/koca\/device\/(\d+)\/eatlog$/);
  if(!match||Buffer.byteLength(payload)>16384)throw new Error('Invalid topic or message size');
  const body=JSON.parse(payload),row=C.normalize(body);
  if(row.deviceId!==Number(match[1])||row.measuredAt>now+60000)throw new Error('Invalid identity or time');
  const parts=typeof body.raw_data==='string'?body.raw_data.trim().split(/\s+/):[];
  if(parts.length!==16||!parts.every(x=>/^\d+$/.test(x))||Number(parts[5])!==row.amount||Number(parts[6])!==row.target)throw new Error('Collector field mismatch');
  return row;
}

function start({credentialFile,host,cacheFile}){
  const mqtt=require('mqtt');
  const credentials=readCredentials(credentialFile);
  const rows=new Map(),histories={};let connected=false,lastMessageAt=null,saveTimer;
  if(cacheFile&&fs.existsSync(cacheFile)){
    try{for(const raw of JSON.parse(fs.readFileSync(cacheFile,'utf8')).rows||[]){const row=C.normalize(raw);if(row.measuredAt<=Date.now()+60000)rows.set(row.deviceId,row);}}catch{}
  }
  const client=mqtt.connect({host,port:1883,protocol:'mqtt',...credentials,
    clientId:'sungam-monitor-'+require('node:crypto').randomBytes(8).toString('hex'),
    // Each connect explicitly awaits a new SUBACK; avoid MQTT.js' duplicate
    // subscribe callback returning [] after its automatic resubscription.
    clean:true,reconnectPeriod:5000,connectTimeout:10000,keepalive:30,resubscribe:false});
  client.on('connect',()=>client.subscribe('farm/koca/device/+/eatlog',{qos:0},(error,granted)=>{
    connected=!error&&granted?.some(x=>x.qos!==128);
    console.log(connected?'Feeder MQTT subscription connected':'Feeder MQTT subscription rejected');
  }));
  client.on('close',()=>{connected=false;});
  client.on('error',()=>{connected=false;});
  client.on('message',(topic,bytes)=>{
    try{
      const row=parseMessage(topic,bytes.toString('utf8')),old=rows.get(row.deviceId);
      if(old&&row.measuredAt<old.measuredAt)return;
      rows.set(row.deviceId,row);lastMessageAt=Date.now();
      const list=histories[row.deviceId]||[];
      if(!list.length||row.measuredAt>list.at(-1).measuredAt)list.push(row);
      histories[row.deviceId]=list.slice(-500);
      if(cacheFile&&!saveTimer)saveTimer=setTimeout(()=>{
        saveTimer=null;
        try{fs.writeFileSync(cacheFile,JSON.stringify({rows:[...rows.values()]}));}catch{console.log('Feeder cache could not be saved');}
      },1000);
    }catch{console.log('Ignored invalid feeder message');}
  });
  return {
    snapshot:()=>({source:'local-mqtt',connected,receivedAt:lastMessageAt,rows:[...rows.values()],histories}),
    close:()=>{clearTimeout(saveTimer);client.end(true);},
  };
}
module.exports={start,parseMessage,readCredentials};
