'use strict';
// Disposable LOCAL demonstration: fake accounts and memory DB, NOT Firebase evidence.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {memory}=require('../../tests/helpers/hc01-memory.cjs');
const {createLifecycleService}=require('./service.cjs');
const {db,data}=memory();
for(const uid of ['A','B'])data.set('hcActors/'+uid,{active:true,hc01Allowed:true,role:'player'});
data.set('hcConfig/runtime',{enabled:true,environment:'sandbox',hc01Enabled:true,
  hc01Rules:{version:'sandbox-4-v1',targetScore:4},hc01PairingTtlMs:120000});
const auth={app:{options:{projectId:'demo-hunter-clash'}},async verifyIdToken(token){if(!['A','B'].includes(token))throw Error('unauthenticated');return {uid:token};}};
const service=createLifecycleService({db,auth},{GCLOUD_PROJECT:'demo-hunter-clash',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098'});
const port=5198,origin='http://127.0.0.1:'+port;
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.headers.host!=='127.0.0.1:'+port){res.writeHead(403);res.end();return;}
  const staticFiles=['/','/pairing.mjs','/controller.mjs','/scanner.mjs','/lab.mjs','/cloud/index.html','/cloud/mobile.css','/cloud/mobile.mjs','/cloud/boot.mjs','/cloud/config.mjs','/cloud/transport.mjs','/vendor/qrcode.min.js','/vendor/jsQR.js'];
  if(req.method==='GET'&&staticFiles.includes(req.url)){
    const file=req.url==='/'?'lab.html':req.url.slice(1);res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,file)));return;
  }
  if(req.method!=='POST'||req.url!=='/command'||req.headers.origin!==origin){res.writeHead(403);res.end();return;}
  let raw='';try{
    for await(const chunk of req){raw+=chunk;if(raw.length>10000)throw Error('body-too-large');}
    const {operation,input}=JSON.parse(raw),token=String(req.headers.authorization||'').replace(/^Bearer /,'');
    const result=await service.run(token,operation,input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log('HC01 disposable local lab: '+origin+' (fake A/B accounts; no cloud writes)'));
process.on('SIGTERM',()=>server.close());
