'use strict';
/**
 * TW-10 Firebase Admin SDK adapter contract.
 * Server-side only: pass initialized Admin Auth and Admin Firestore instances.
 * This module deliberately does not initialize Firebase, expose HTTP routes,
 * accept client role claims, deploy, or write Firestore documents.
 */
const {readTaiwanReviewQueue}=require('./catalog-tw08-read-gateway.cjs');
const {projectTrustedUserProfile}=require('./catalog-tw11-role-policy.cjs');
const UID=/^[A-Za-z0-9_-]{2,128}$/;
function createTw10AdminAdapter({adminAuth,adminFirestore,loadResearchBatch}={}){
 if(!adminAuth||typeof adminAuth.verifyIdToken!=='function'||
    !adminFirestore||typeof adminFirestore.collection!=='function'||
    typeof loadResearchBatch!=='function')throw Error('TW10_SERVER_DEPENDENCIES_REQUIRED');
 const adapter=Object.freeze({
  verifyIdToken:async(token,checkRevoked)=>{
   if(checkRevoked!==true)throw Error('TW10_REVOCATION_CHECK_REQUIRED');
   return adminAuth.verifyIdToken(token,true);
  },
  loadUserByUid:async uid=>{
   if(!UID.test(uid||''))throw Error('TW10_UID_INVALID');
   const snap=await adminFirestore.collection('users').doc(uid).get();
   if(!snap.exists)return null;
   const data=snap.data();
   // No client-provided role or status is accepted.
   return projectTrustedUserProfile(data);
  },
  loadResearchBatch:async()=>{
   const batch=await loadResearchBatch();
   if(!batch||batch.batchId!=='DATA-01B-20261009-ZHTW-TW05'||
      batch.productionWritable!==false||batch.autoPublish!==false)
    throw Error('TW10_UNTRUSTED_RESEARCH_BATCH');
   return batch;
  }
 });
 return adapter;
}
async function readTw10AdminReviewQueue({adminAuth,adminFirestore,loadResearchBatch,idToken,request}={}){
 const adapter=createTw10AdminAdapter({adminAuth,adminFirestore,loadResearchBatch});
 return readTaiwanReviewQueue({adapter,idToken,request});
}
module.exports={createTw10AdminAdapter,readTw10AdminReviewQueue};
