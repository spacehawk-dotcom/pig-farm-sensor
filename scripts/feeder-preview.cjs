/* Local read-only preview. Only an explicit static allowlist is served. */
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const C=require('../feeder-core.js');
const root=path.resolve(__dirname,'..');
const logDir=process.argv[2],day=process.argv[3]||C.koreanDay().replaceAll('-','');
const port=Number(process.env.FEEDER_PREVIEW_PORT||8091);
const staticFiles=new Set(['feeders.html','feeders.css','feeders.js','feeder-core.js','FEEDER-SETUP.md']);
let archive;
async function readArchive(){
  if(archive)return archive;
  const rows=[],histories={};
  if(logDir){for(const name of await fs.readdir(logDir)){
    const m=name.match(/^(\d{8})_(\d{1,2})(?:\.txt)?$/);if(!m||m[1]!==day)continue;
    const list=C.parseLog(await fs.readFile(path.join(logDir,name),'utf8'),Number(m[2]));
    if(list.length){histories[m[2]]=list;rows.push(list.at(-1));}
  }}
  archive={source:'uploaded-koca-logs',rows:C.merge([],rows),histories};return archive;
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try{
    if(req.method!=='GET'){res.writeHead(405,headers);return res.end();}
    if(url.pathname==='/api/feeder-archive'){res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(await readArchive()));}
    if(url.pathname==='/.netlify/functions/feeders'){res.writeHead(503,{...headers,'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Local preview: HA bridge not connected'}));}
    const name=url.pathname==='/'?'feeders.html':url.pathname.slice(1);
    if(!staticFiles.has(name)){res.writeHead(404,headers);return res.end('Not found');}
    const content=await fs.readFile(path.join(root,name));const type={'.html':'text/html','.css':'text/css','.js':'application/javascript','.md':'text/plain'}[path.extname(name)];
    res.writeHead(200,{...headers,'Content-Type':`${type}; charset=utf-8`});res.end(content);
  }catch{res.writeHead(500,headers);res.end('Preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}/feeders.html?view=records`));
