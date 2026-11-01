'use strict';
// Definitions only: this module does not initialize Firebase or export deployed functions.
function wrapBucketHandler(handle,HttpsError){return async request=>{
 if(typeof request.auth?.uid!=='string'||!request.auth.uid)throw new HttpsError('unauthenticated','auth-required',{reason:'auth-required'});
 if(typeof request.app?.appId!=='string'||!request.app.appId)throw new HttpsError('unauthenticated','app-check-required',{reason:'app-check-required'});
 try{return await handle(request);}catch(error){
  const reason=error.seatCode||error.message;
  if(typeof reason!=='string'||!/^[-a-z0-9]{1,80}$/.test(reason))throw new HttpsError('internal','bucket-unavailable');
  const denied=['station-not-assigned','not-event-staff','permission-denied','requester-ineligible','target-ineligible'];
  throw new HttpsError(reason==='unauthenticated'?'unauthenticated':denied.includes(reason)?'permission-denied':'failed-precondition',reason,{reason});
 }
};}
function createBucketCallableDefinitions({onCall,HttpsError,scoreHandler,seatHandler}){
 const options={region:'asia-east1',timeoutSeconds:30,maxInstances:10,invoker:'public',enforceAppCheck:true,cors:true};
 return {
  commitBucketRefereeCommand:onCall({...options},wrapBucketHandler(scoreHandler,HttpsError)),
  manageBucketRefereeSeats:onCall({...options},wrapBucketHandler(seatHandler,HttpsError))
 };
}
module.exports={createBucketCallableDefinitions,wrapBucketHandler};
