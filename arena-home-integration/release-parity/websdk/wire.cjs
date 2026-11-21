'use strict';
const ORIGIN='http://127.0.0.1:8188';
const ENDPOINTS=new Map([['/google.firestore.v1.Firestore/Listen/channel','listen'],
 ['/google.firestore.v1.Firestore/RunQuery','runQuery'],['/google.firestore.v1.Firestore/RunQuery/channel','runQuery'],
 ['/google.firestore.v1.Firestore/BatchGetDocuments','batchGet']]);
async function attachBodyMeter(context,page){
 const session=await context.newCDPSession(page),tracked=new Map(), seen=[];
 const sizeKey=['requestBodySize','requestHeadersSize','responseBodySize','responseHeadersSize'];
 await session.send('Network.enable');
 await session.send('Network.setCacheDisabled',{cacheDisabled:true});
 session.on('Network.requestWillBeSent',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==ORIGIN)return;
  const row={kind:ENDPOINTS.get(u.pathname)||'other',status:null,failed:false,finished:false};
  tracked.set(e.requestId,row);seen.push(row);
 });
 session.on('Network.responseReceived',e=>{const row=tracked.get(e.requestId);if(row)row.status=e.response.status;});
 let window=null;
 const networkRequests=new WeakMap();
 page.on('request',req=>{
  const u=new URL(req.url());
  if(window&&u.origin===ORIGIN&&ENDPOINTS.has(u.pathname))networkRequests.set(req,window);
 });
 page.on('requestfinished',req=>{
  const phase=networkRequests.get(req);
  if(!phase||window!==phase)return;
  phase.httpCompleted++;
  phase.httpTasks.push(req.sizes().then(s=>{
   if(sizeKey.every(k=>Number.isSafeInteger(s[k])&&s[k]>=0)){
    for(const k of sizeKey)phase.completedHttpSizes[k]+=s[k];
    phase.httpWithSizes++;
   }
  }).catch(()=>{}));
 });
 session.on('Network.dataReceived',e=>{
  const row=tracked.get(e.requestId);
  if(!row||!window)return;
  if(!Number.isSafeInteger(e.dataLength)||e.dataLength<0){window.unknown++;return;}
  window.bytes[row.kind]=(window.bytes[row.kind]||0)+e.dataLength;
  window.chunks++;
  if(e.encodedDataLength===0&&e.dataLength>0)window.zeroEncodedChunks++;
 });
 session.on('Network.loadingFinished',e=>{const row=tracked.get(e.requestId);if(row)row.finished=true;});
 session.on('Network.loadingFailed',e=>{const row=tracked.get(e.requestId);if(row)row.failed=true;});
 return {
  begin(){if(window)throw Error('wire-window-open');window={bytes:{},chunks:0,zeroEncodedChunks:0,unknown:0,httpCompleted:0,httpWithSizes:0,httpTasks:[],
   completedHttpSizes:Object.fromEntries(sizeKey.map(k=>[k,0]))};},
  async end(){
   if(!window)throw Error('wire-window-missing');
   const stage=window;window=null;
   await Promise.race([Promise.allSettled(stage.httpTasks),new Promise(r=>setTimeout(r,1000))]);
   const {httpTasks,...report}=stage;
   const allowedBytes=['listen','runQuery','batchGet'].reduce((n,k)=>n+(stage.bytes[k]||0),0);
   return {...report,firestoreResponseBodyBytes:stage.chunks>0&&!stage.unknown&&!(stage.bytes.other>0)&&allowedBytes>0?allowedBytes:null,
    openKnownRequests:seen.filter(r=>!r.finished&&!r.failed&&r.kind!=='other').length,
    meaning:'CDP decoded Firestore response body chunks delivered inside phase, including open responses; completedHttpSizes is separate bounded Playwright HTTP subset, not total encoded wire, TCP/TLS, production metrics or billing'};
  }
 };
}
module.exports={attachBodyMeter};
