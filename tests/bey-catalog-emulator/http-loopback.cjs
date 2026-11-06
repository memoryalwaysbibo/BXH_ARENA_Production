'use strict';
/** Test transport only: real Express/HTTP, bound exclusively to loopback. */
const http=require('node:http');
const express=require('express');
async function startLoopbackHttp(handler){
 if(typeof handler!=='function')throw Error('HTTP_TEST_HANDLER_REQUIRED');
 const app=express();
 app.disable('x-powered-by');
 app.use(express.json({limit:4096}));
 app.use(handler);
 // Local transport parse errors must not expose raw request bodies or stacks.
 app.use((error,req,res,next)=>{res.status(400).json({error:'INVALID_REQUEST'});});
 const server=http.createServer(app);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();
 if(address.address!=='127.0.0.1'){server.close();throw Error('HTTP_TEST_LOOPBACK_REQUIRED');}
 const url='http://127.0.0.1:'+address.port+'/';
 async function request({method='POST',headers={},body={}}={}){
  const r=await fetch(url,{method,headers:{'content-type':'application/json',...headers},
   body:['GET','HEAD','OPTIONS'].includes(method)?undefined:(typeof body==='string'?body:JSON.stringify(body)),
   signal:AbortSignal.timeout(15000)});
  const raw=await r.text();
  return {code:r.status,headers:Object.fromEntries(r.headers),body:raw?JSON.parse(raw):''};
 }
 async function close(){
  await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
 }
 return {request,close};
}
module.exports={startLoopbackHttp};
