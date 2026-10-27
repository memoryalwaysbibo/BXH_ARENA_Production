'use strict';
const {createMembershipService}=require('./membership.cjs');
const ACTION_FIELDS=Object.freeze({create:['name'],apply:[],cancel:[],approve:['targetUid'],reject:['targetUid'],leave:[],remove:['targetUid','reasonCode','reasonNote'],transfer:['targetUid'],assign:['targetUid','role'],frame:['frame'],dissolve:[],admission:['policy']});
function createCommandHandler({db,auth,enabled=false,readEligibility,readDisplayName,clock,HttpsError}){
 if(typeof HttpsError!=='function')throw Error('https-error-required');
 const command=createMembershipService({db,readEligibility,readDisplayName,clock});
 const fail=(code,message)=>{throw new HttpsError(code,message);};
 return async request=>{
  if(!enabled)fail('failed-precondition','teams-unavailable');
  if(!request?.app?.appId)fail('failed-precondition','app-check-required');
  const uid=request.auth?.uid;if(!uid)fail('unauthenticated','sign-in-required');
  const data=request.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(ACTION_FIELDS,data.action))fail('invalid-argument','invalid-team-command');
  const allowed=['action','teamId','requestId',...ACTION_FIELDS[data.action]];
  if(Object.keys(data).some(key=>!allowed.includes(key)))fail('invalid-argument','unexpected-command-field');
  // Auth context is supplied by Callable verification, never browser JSON.
  let user;try{user=await auth.getUser(uid);}catch(_){fail('unauthenticated','account-unavailable');}
  if(user.disabled)fail('permission-denied','account-disabled');
  const validAfter=Date.parse(user.tokensValidAfterTime||'');
  if(Number.isFinite(validAfter)&&(!Number.isFinite(request.auth.token?.auth_time)||request.auth.token.auth_time*1000<validAfter))fail('unauthenticated','sign-in-again');
  try{return await command({...data,actorUid:uid});}
  catch(error){
   const message=error?.message||'';
   const denied=['captain-required','leadership-required','not-member'];
   const precondition=['already-in-team','team-id-taken','team-not-found','team-dissolved','team-full','transfer-captain-first','team-must-be-solo','application-not-pending','cannot-target-self','use-captain-transfer','role-full','frame-locked','operation-id-conflict','ladder-tier-below-minimum','tier-below-minimum'];
   if(denied.includes(message))fail('permission-denied',message);
   if(precondition.includes(message))fail('failed-precondition',message);
   if(/^invalid-(id|request-id|name|action|admission-mode|ladder-tier|min-tier)$/.test(message)||['removal-reason-required','other-reason-required','reason-too-long'].includes(message))fail('invalid-argument',message);
   fail('internal','team-command-unavailable');
  }
 };
}
module.exports={createCommandHandler};
