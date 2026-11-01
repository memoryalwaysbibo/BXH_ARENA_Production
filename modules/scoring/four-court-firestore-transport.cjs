(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.BXHFourCourtFirestore=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Dependency-injected candidate; importing this file does not initialize Firebase.
 function create({db,auth,fs,authApi,commitScore,manageSeats}){
  const uid=auth?.currentUser?.uid;
  if(!uid||!db||!fs?.onSnapshot||!fs?.doc||!authApi?.onAuthStateChanged||typeof commitScore!=='function'||typeof manageSeats!=='function')throw Error('auth-required');
  const validCode=code=>/^BXH-[A-Z0-9]{4,16}$/.test(code);
  function listen(ref,convert,next,error){
   let stopped=false,stopDoc=()=>{},stopAuth=()=>{};
   const stop=()=>{stopped=true;stopDoc();stopAuth();};
   const fail=reason=>{if(stopped)return;stop();error(reason);};
   if(auth.currentUser?.uid!==uid){queueMicrotask(()=>fail(Error('auth-changed')));return stop;}
   stopAuth=authApi.onAuthStateChanged(auth,user=>{if(user?.uid!==uid)fail(Error('auth-changed'));});
   if(!stopped)stopDoc=fs.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
    if(stopped)return;
    try{next({...convert(snapshot),fromCache:snapshot.metadata.fromCache,pending:snapshot.metadata.hasPendingWrites});}catch(reason){fail(reason);}
   },fail);
   if(stopped){stopDoc();stopAuth();}
   return stop;
  }
  return {
   projectId:db.app?.options?.projectId||null,
   watchRoom(code,next,error){
    if(!validCode(code))throw Error('invalid-code');
    return listen(fs.doc(db,'tournaments',code),snapshot=>{
     if(!snapshot.exists())throw Error('room-missing');
     const room=snapshot.data();
     // Web SDK has no public document updateTime API. All candidate structural
     // writers advance this server-owned numeric version monotonically.
     if(!Number.isSafeInteger(room.updatedAt)||room.updatedAt<0)throw Error('room-version-missing');
     return {room,version:String(room.updatedAt)};
    },next,error);
   },
   watchBucket(code,id,next,error){
    if(!validCode(code)||!/^court-[1-9][0-9]*$/.test(id))throw Error('invalid-bucket');
    return listen(fs.doc(db,'tournaments',code,'matchBuckets',id),snapshot=>({bucket:snapshot.exists()?snapshot.data():null}),next,error);
   },
   async commitScore(data){if(auth.currentUser?.uid!==uid)return {ok:false,reason:'auth-changed'};return commitScore(data);},
   async manageSeats(data){if(auth.currentUser?.uid!==uid)return {ok:false,reason:'auth-changed'};return manageSeats(data);}
  };
 }
 return {create};
});
