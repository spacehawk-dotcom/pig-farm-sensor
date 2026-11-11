import winch from './lib/winch-handler.cjs';

export default async function(request){
  const json=(data,status)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
  if(request.method!=='POST')return json({error:'POST required'},405);
  try{
    const body=await request.text();
    if(body.length>65536)return json({error:'Too large'},413);
    return json(await winch.worker(request.headers.get('x-ha-bridge'),JSON.parse(body)),200);
  }catch(e){return json({error:e.status===401?'Unauthorized':'Bridge request failed'},e.status||502);}
}
