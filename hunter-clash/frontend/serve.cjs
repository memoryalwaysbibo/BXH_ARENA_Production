'use strict';
const http=require('node:http');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {assertIsolated}=require('../emulator/preflight.cjs');
const files={'/':['index.html','text/html; charset=utf-8'],'/app.mjs':['app.mjs','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
function createServer(){
  assertIsolated(process.env);
  return http.createServer((req,res)=>{
    if(req.headers.host!=='127.0.0.1:5199'||!['GET','HEAD'].includes(req.method)||!Object.hasOwn(files,req.url)){
      res.writeHead(404);res.end();return;
    }
    const [file,type]=files[req.url];res.writeHead(200,{'content-type':type,'cache-control':'no-store',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
      'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src http://127.0.0.1:5003 http://127.0.0.1:9098; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
    res.end(req.method==='HEAD'?undefined:readFileSync(path.join(__dirname,file)));
  });
}
if(require.main===module)createServer().listen(5199,'127.0.0.1',()=>process.stdout.write('HC internal test UI: http://127.0.0.1:5199\n'));
module.exports={createServer};
