'use strict';
const {createReadService}=require('./read-service.cjs');
const {createListService}=require('./list-service.cjs');
function createReadHandler({db,auth,HttpsError,enabled=false}){
 const read=createReadService({db}),list=createListService({db});const fail=(code,msg)=>{throw new HttpsError(code,msg);};
 return async request=>{
  if(!enabled)fail('failed-precondition','teams-unavailable');
  if(!request?.app?.appId)fail('failed-precondition','app-check-required');
  const uid=request.auth?.uid;if(!uid)fail('unauthenticated','sign-in-required');
  const data=request.data;
  if(!data||!['members','history','reason','list','mine','applications'].includes(data.action))fail('invalid-argument','invalid-team-read');
  const allowed=data.action==='reason'?['action','teamId','historyId']:data.action==='list'?['action','query']:data.action==='mine'?['action']:['action','teamId'];
  if(Object.keys(data).some(k=>!allowed.includes(k)))fail('invalid-argument','unexpected-read-field');
  let user;try{user=await auth.getUser(uid);}catch(_){fail('unauthenticated','account-unavailable');}
  if(user.disabled)fail('permission-denied','account-disabled');
  const revokedAt=Date.parse(user.tokensValidAfterTime||'');
  if(Number.isFinite(revokedAt)&&(!Number.isFinite(request.auth.token?.auth_time)||request.auth.token.auth_time*1000<revokedAt))fail('unauthenticated','sign-in-again');
  try{return data.action==='list'?await list({actorUid:uid,query:data.query}):await read({...data,actorUid:uid});}catch(error){
   if(error.message==='permission-denied')fail('permission-denied','team-read-denied');
   if(error.message==='projection-stale')fail('unavailable','team-data-refreshing');
   if(['invalid-list-query','invalid-pagination-or-level','invalid-filter'].includes(error.message))fail('invalid-argument','invalid-team-list');
   if(['team-list-capacity-exceeded','source-unavailable'].includes(error.message))fail('unavailable','team-list-unavailable');
   if(error.message==='invalid-read')fail('invalid-argument','invalid-team-read');
   if(['team-not-found','history-not-found'].includes(error.message))fail('not-found',error.message);
   fail('internal','team-read-unavailable');
  }
 };
}
module.exports={createReadHandler};
