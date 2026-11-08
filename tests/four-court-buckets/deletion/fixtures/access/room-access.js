'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {getFirestore}=require("./_qr_checkin/admin-firestore.cjs");
const service=require('./room-access-service').createRoomAccessService(getFirestore());
exports.roomAccess=onCall({region:'asia-east1',cors:true,timeoutSeconds:60,maxInstances:5},async req=>{
 if(process.env.GCLOUD_PROJECT!=='bxh-arena')throw new HttpsError('failed-precondition','production-only');
 try{return await service(req);}catch(e){
  const m=String(e.message||'');
  if(m==='auth-required')throw new HttpsError('unauthenticated',m);
  if(m==='room-access-denied')throw new HttpsError('permission-denied',m);
  if(/^[a-z][a-z-]{2,80}$/.test(m))throw new HttpsError('failed-precondition',m,e.details);
  console.error('[roomAccess]',e);throw new HttpsError('internal','room-access-unavailable');
 }
});
