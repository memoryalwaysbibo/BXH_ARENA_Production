(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./four-court-client.cjs'),require('./four-court-firestore-transport.cjs'),require('./four-court-app-bridge.cjs'));
 else root.BXHFourCourtSession=factory(root.BXHFourCourtClient,root.BXHFourCourtFirestore,root.BXHFourCourtAppBridge);
})(typeof globalThis!=='undefined'?globalThis:this,function(Client,Transport,Bridge){
 'use strict';
 function callable(api,functions,name){
  const invoke=api.httpsCallable(functions,name,{timeout:30000});
  return async data=>{try{return (await invoke(data)).data;}catch(error){
   if(['functions/unavailable','functions/deadline-exceeded','functions/internal'].includes(error.code))return {ok:false,reason:'cloud-unavailable'};
   return {ok:false,reason:error.details?.reason||(['functions/unauthenticated','functions/permission-denied'].includes(error.code)?'authentication-required':/^[-a-z0-9]{1,80}$/.test(error.message||'')?error.message:'cloud-unavailable')};
  }};
 }
 function create({enabled=false,db,auth,fs,authApi,functions,functionsApi,code,legacy={},onState=()=>{},onView=()=>{}}){
  if(enabled!==true)throw Error('bucket-client-disabled');
  const uid=auth?.currentUser?.uid;if(!uid)throw Error('auth-required');
  const transport=Transport.create({db,auth,fs,authApi,commitScore:callable(functionsApi,functions,'commitBucketRefereeCommand'),manageSeats:callable(functionsApi,functions,'manageBucketRefereeSeats')});
  let bridge=null,target=null,original=null,unsubscribe=null,closed=false,started=false;
  const client=Client.create({transport,code,uid,operationId:()=>globalThis.crypto.randomUUID(),onView:view=>{bridge?.publish(view);onView(view);}});
  bridge=Bridge.create({client,code,uid,getUid:()=>auth.currentUser?.uid,legacy});
  return {client,transport,
   start(host){if(closed||started)throw Error('session-already-started');started=true;target=host;original=host.cloudSync;host.cloudSync=bridge.cloud;unsubscribe=bridge.cloud.subscribe(code,onState);client.connect();},
   stop(){if(closed)return;closed=true;unsubscribe?.();bridge.close();client.disconnect();if(target?.cloudSync===bridge.cloud)target.cloudSync=original;}
  };
 }
 return {create,callable};
});
