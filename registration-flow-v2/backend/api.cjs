'use strict';
function isPlayerSubmission(operation,code){
 const payload=operation?.payload;
 if(!payload||operation.code!==code||payload.code!==code)return false;
 if(operation.route==='family')return payload.action==='join';
 return operation.route==='roster'&&payload.action==='cancel'&&payload.intent==='player'
  &&typeof payload.registrationId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(payload.registrationId)
  &&(payload.localId===undefined||payload.localId==='');
}
// Factory only: no exports are registered with Firebase by importing this file.
// The rollout gate must be backed by server configuration, never client input.
function createApi({queue,family,enabled=async()=>false}){
 return async req=>{
  const uid=req.auth?.uid,d=req.data||{};
  if(!uid)throw Error('auth-required');
  if(!await enabled(d.code))throw Error('registration-queue-disabled');
  if(d.action==='submit'){
   if(!isPlayerSubmission(d.operation,d.code))throw Error('invalid-operation');
   return queue.enqueue(uid,d.operation);
  }
  if(d.action==='status')return queue.status(uid,d.code,d.operationId);
  if(d.action==='mine'){
   const result=await family({auth:req.auth,data:{action:'mine',code:d.code}});
   const operation=d.operationId?(await queue.status(uid,d.code,d.operationId)).operation:null;
   return {...result,...(operation?{operation}:{})};
  }
  // Family preview remains available for multi-child allocation confirmation.
  if(d.action==='preview')return family({auth:req.auth,data:{...d,action:'preview'}});
  throw Error('invalid-operation');
 };
}
module.exports={createApi};
