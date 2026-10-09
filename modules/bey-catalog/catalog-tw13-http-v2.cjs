'use strict';
/**
 * TW-13: Cloud Functions v2 onRequest integration FACTORY, never deployed.
 * The injected onRequest must be the trusted firebase-functions/v2/https export.
 * Tokens are verified server-side by TW-12. No direct Firestore writes here.
 */
const {readTw12CatalogQueue}=require('./catalog-tw12-secure-read.cjs');
const {parseRequest}=require('./catalog-tw08-read-gateway.cjs');
const MAX_BODY_BYTES=4096;
const ALLOWED_FIELDS=new Set(['filter','query','limit','cursor']);
function errorStatus(error){
 const code=String(error?.message||'');
 if(['TW12_CREDENTIALS_REQUIRED','TW12_VERIFIED_USER_REQUIRED'].includes(code))return [401,'UNAUTHENTICATED'];
 if(['TW12_APP_CHECK_DENIED','INVALID_APP_CHECK'].includes(code))return [403,'APP_CHECK_DENIED'];
 if(code==='TW12_RATE_LIMITED')return [429,'RATE_LIMITED'];
 if(['TW12_AUDIT_REQUIRED','TW12_TRUSTED_SERVER_DEPENDENCIES_REQUIRED'].includes(code))return [503,'SERVICE_UNAVAILABLE'];
 if(code==='TW08_REQUEST_INVALID'||code==='TW08_STALE_OR_INVALID_CURSOR'||code==='TW08_CURSOR_OUT_OF_RANGE')return [400,'INVALID_REQUEST'];
 // Do not expose tokens, role details, internal paths, or stack traces.
 return [503,'SERVICE_UNAVAILABLE'];
}
function createTw13HttpV2Handler({onRequest,dependencies,allowedOrigins}={}){
 if(typeof onRequest!=='function'||!dependencies||!Array.isArray(allowedOrigins)||
    !allowedOrigins.length||allowedOrigins.some(x=>typeof x!=='string'||!/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/i.test(x)))
  throw Error('TW13_TRUSTED_FACTORY_CONFIG_REQUIRED');
 const origins=new Set(allowedOrigins);
 return onRequest({cors:false,timeoutSeconds:30,memory:'256MiB',maxInstances:3},async(req,res)=>{
  const origin=req.headers?.origin;
  if(typeof origin!=='string'||!origins.has(origin)){
   res.status(403).json({error:'ORIGIN_DENIED'});return;
  }
  res.set('Access-Control-Allow-Origin',origin);
  res.set('Vary','Origin');
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS'){
   res.set('Access-Control-Allow-Methods','POST, OPTIONS');
   res.set('Access-Control-Allow-Headers','Authorization, X-Firebase-AppCheck, Content-Type');
   res.status(204).send('');return;
  }
  if(req.method!=='POST'){res.status(405).json({error:'METHOD_NOT_ALLOWED'});return;}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type']||'')){
   res.status(415).json({error:'JSON_REQUIRED'});return;
  }
  const payload=req.body;
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
     Object.keys(payload).some(k=>!ALLOWED_FIELDS.has(k))||
     Buffer.byteLength(JSON.stringify(payload),'utf8')>MAX_BODY_BYTES){
   res.status(400).json({error:'INVALID_REQUEST'});return;
  }
  let request;
  try{request=parseRequest(payload);}catch(_){res.status(400).json({error:'INVALID_REQUEST'});return;}
  const authorization=req.headers?.authorization||'';
  const match=/^Bearer ([A-Za-z0-9._~-]{10,8192})$/.exec(authorization);
  const appCheckToken=req.headers?.['x-firebase-appcheck'];
  if(!match||typeof appCheckToken!=='string'||!appCheckToken){
   res.status(401).json({error:'UNAUTHENTICATED'});return;
  }
  try{
   const result=await readTw12CatalogQueue({
    dependencies,appCheckToken,idToken:match[1],request
   });
   if(result.access==='denied'){res.status(403).json({error:'FORBIDDEN'});return;}
   res.status(200).json(result);
  }catch(e){
   const [status,error]=errorStatus(e);
   res.status(status).json({error});
  }
 });
}
module.exports={createTw13HttpV2Handler,errorStatus};
