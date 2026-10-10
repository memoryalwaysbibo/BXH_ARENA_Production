'use strict';
/**
 * TW-12 transport-neutral, server-only read gateway. NOT a deployed Cloud Function.
 * Inject trusted Firebase Admin SDK instances and server-managed rate limiter/audit.
 * Fail closed: App Check, Auth, rate limit, and audit must all succeed.
 */
const {readTw10AdminReviewQueue}=require('./catalog-tw10-admin-adapter.cjs');
const {parseRequest}=require('./catalog-tw08-read-gateway.cjs');
const UID=/^[A-Za-z0-9_-]{2,128}$/;
function assertDeps(d){
 if(!d||!d.adminAppCheck||typeof d.adminAppCheck.verifyToken!=='function'||
    !d.adminAuth||typeof d.adminAuth.verifyIdToken!=='function'||
    !d.adminFirestore||typeof d.adminFirestore.collection!=='function'||
    typeof d.loadResearchBatch!=='function'||
    typeof d.consumeRateLimit!=='function'||typeof d.recordAudit!=='function'||
    !Array.isArray(d.allowedAppIds)||d.allowedAppIds.length===0||
    d.allowedAppIds.some(x=>typeof x!=='string'||!x.trim()))
   throw Error('TW12_TRUSTED_SERVER_DEPENDENCIES_REQUIRED');
}
async function readTw12CatalogQueue({dependencies,appCheckToken,idToken,request}={}){
 assertDeps(dependencies);
 const params=parseRequest(request);
 if(typeof appCheckToken!=='string'||!appCheckToken||appCheckToken.length>8192||
    typeof idToken!=='string'||!idToken||idToken.length>8192)throw Error('TW12_CREDENTIALS_REQUIRED');
 // Real Admin App Check verifyToken must be called by trusted backend.
 const app=await dependencies.adminAppCheck.verifyToken(appCheckToken);
 if(!app||typeof app.appId!=='string'||!dependencies.allowedAppIds.includes(app.appId))
  throw Error('TW12_APP_CHECK_DENIED');
 const decoded=await dependencies.adminAuth.verifyIdToken(idToken,true);
 const uid=decoded?.uid;
 if(!UID.test(uid||'')||decoded.firebase?.sign_in_provider==='anonymous')
  throw Error('TW12_VERIFIED_USER_REQUIRED');
 // External atomic quota backend is mandatory; in-memory counters are not safe
 // for multi-instance Cloud Functions. Do not allow client-supplied rate keys.
 const permitted=await dependencies.consumeRateLimit({uid,operation:'tw12.catalog.review.read'});
 if(permitted!==true)throw Error('TW12_RATE_LIMITED');
 // Reuse TW-10 server profile check and TW-08 research isolation.
 const boundAuth={verifyIdToken:async(token,checkRevoked)=>{
  if(token!==idToken||checkRevoked!==true)throw Error('TW12_AUTH_CONTEXT_MISMATCH');
  const rechecked=await dependencies.adminAuth.verifyIdToken(token,true);
  if(rechecked?.uid!==uid||rechecked.firebase?.sign_in_provider==='anonymous')throw Error('TW12_AUTH_CONTEXT_MISMATCH');
  return rechecked;
 }};
 const result=await readTw10AdminReviewQueue({
  adminAuth:boundAuth,adminFirestore:dependencies.adminFirestore,
  loadResearchBatch:dependencies.loadResearchBatch,idToken,request:params
 });
 // Record only non-sensitive metadata. No raw tokens, query or catalog contents.
 const recorded=await dependencies.recordAudit({
  uid,operation:'tw12.catalog.review.read',outcome:result.access,
  count:result.items.length,filter:params.filter,
  sourceBatchId:result.sourceBatchId||null
 });
 if(recorded!==true)throw Error('TW12_AUDIT_REQUIRED');
 return result;
}
module.exports={readTw12CatalogQueue,assertDeps};
