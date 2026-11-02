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
  const gates=new Set();let profileReady=false,accessError=null,gateGeneration=0,stopProfile=()=>{},stopIdentity=()=>{};
  function stopGate(){gateGeneration++;stopProfile();stopIdentity();stopProfile=()=>{};stopIdentity=()=>{};profileReady=false;}
  function startGate(){
   const token=++gateGeneration;profileReady=false;accessError=null;
   const fail=reason=>{if(token!==gateGeneration)return;profileReady=false;accessError=reason;for(const callback of [...gates])callback(reason);};
   stopIdentity=authApi.onAuthStateChanged(auth,user=>{if(user?.uid!==uid)fail(Error('auth-changed'));});
   if(token===gateGeneration)stopProfile=fs.onSnapshot(fs.doc(db,'users',uid),{includeMetadataChanges:true},snapshot=>{
    if(token!==gateGeneration||snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
    const profile=snapshot.exists()?snapshot.data():null;
    if(profile?.active!==true||profile.isTestAccount===true||!['staff','admin','super_admin'].includes(profile.role))return fail(Error('profile-access-revoked'));
    profileReady=true;for(const callback of [...gates])callback(null);
   },fail);
   if(!gates.size)stopGate();
  }
  function subscribeGate(callback){
   gates.add(callback);if(gates.size===1)startGate();else if(profileReady)queueMicrotask(()=>{if(gates.has(callback))callback(null);});
   return ()=>{gates.delete(callback);if(!gates.size)stopGate();};
  }
  function listen(ref,convert,next,error){
   let stopped=false,ready=false,last=null,stopDoc=()=>{},stopAccess=()=>{};
   const stop=()=>{stopped=true;stopDoc();stopAccess();};
   const fail=reason=>{if(stopped)return;stop();error(reason);};
   const emit=()=>{if(stopped||!ready||!last)return;try{next({...convert(last),fromCache:last.metadata.fromCache,pending:last.metadata.hasPendingWrites});}catch(reason){fail(reason);}};
   if(auth.currentUser?.uid!==uid){queueMicrotask(()=>fail(Error('auth-changed')));return stop;}
   stopAccess=subscribeGate(reason=>{if(reason)return fail(reason);ready=true;emit();});
   if(!stopped)stopDoc=fs.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
    if(stopped)return;last=snapshot;emit();
   },fail);
   if(stopped){stopDoc();stopAccess();}
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
   async commitScore(data){if(auth.currentUser?.uid!==uid)return {ok:false,reason:'auth-changed'};if(!profileReady)return {ok:false,reason:accessError?.message||'not-synchronized'};return commitScore(data);},
   async manageSeats(data){if(auth.currentUser?.uid!==uid)return {ok:false,reason:'auth-changed'};if(!profileReady)return {ok:false,reason:accessError?.message||'not-synchronized'};return manageSeats(data);}
  };
 }
 return {create};
});
