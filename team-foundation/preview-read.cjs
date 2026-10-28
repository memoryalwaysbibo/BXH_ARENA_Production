'use strict';
const {createReadHandler}=require('./read-callable.cjs');
// Separate opt-in read-only endpoint. Never opens commands or background workers.
function createPreviewReadHandler({db,auth,HttpsError,enabled=false}){
 const read=createReadHandler({db,auth,HttpsError,enabled:true});
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 return async request=>{
  if(!enabled)fail('failed-precondition','teams-preview-unavailable');
  if(!request?.app?.appId)fail('failed-precondition','app-check-required');
  const uid=request.auth?.uid;
  if(typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))fail('unauthenticated','sign-in-required');
  if(!['mine','list','ranking','members'].includes(request.data?.action))fail('invalid-argument','invalid-preview-read');
  let account;
  try{account=await auth.getUser(uid);}catch{fail('unauthenticated','account-unavailable');}
  if(account.disabled)fail('permission-denied','account-disabled');
  const revokedAt=Date.parse(account.tokensValidAfterTime||'');
  if(Number.isFinite(revokedAt)&&(!Number.isFinite(request.auth.token?.auth_time)||request.auth.token.auth_time*1000<revokedAt))fail('unauthenticated','sign-in-again');
  let profile;
  try{const snap=await db.doc('users/'+uid).get();profile=snap.exists?snap.data():null;}
  catch{fail('permission-denied','team-preview-denied');}
  if(profile?.role!=='super_admin'||profile.active!==true||profile.isTestAccount===true)fail('permission-denied','team-preview-denied');
  // The regular boundary revalidates the payload and account; canonical team
  // permissions still apply. No role claim or selected UID comes from the client.
  return read(request);
 };
}
module.exports={createPreviewReadHandler};
