(function(){
 'use strict';
 const sdk=BXHBrowserSDK,code=new URL(location.href).searchParams.get('code'),native=new URL(location.href).searchParams.get('callable')==='1';
 if(location.hostname!=='127.0.0.1'||!/^BXH-AUTH(6|12)$/.test(code))throw Error('emulator-only');
 const app=sdk.initializeApp({projectId:'demo-bxh-four-court-buckets',apiKey:'fake-emulator-key',authDomain:'demo-bxh-four-court-buckets.firebaseapp.com',appId:'1:123456:web:bucket-emulator'}),auth=sdk.getAuth(app),db=sdk.getFirestore(app);
 sdk.connectAuthEmulator(auth,'http://127.0.0.1:9198',{disableWarnings:true});sdk.connectFirestoreEmulator(db,'127.0.0.1',8188);
 const persistence=sdk.setPersistence(auth,sdk.inMemoryPersistence);let bridge=null,sessionUid=null,session=null,functions=null,appCheckToken=null;
 if(native){
  // Unsigned fixture token is accepted only by the Functions Emulator's own
  // debug verification path. It cannot attest a production Firebase app.
  const encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'),now=Math.floor(Date.now()/1000);
  appCheckToken=encode({alg:'none',typ:'JWT'})+'.'+encode({sub:'1:123456:web:bucket-emulator',aud:['projects/123456'],iss:'https://firebaseappcheck.googleapis.com/123456',iat:now,exp:now+3600})+'.';
  sdk.initializeAppCheck(app,{provider:new sdk.CustomProvider({getToken:async()=>({token:appCheckToken,expireTimeMillis:(now+3600)*1000})}),isTokenAutoRefreshEnabled:false});
  functions=sdk.getFunctions(app,'asia-east1');sdk.connectFunctionsEmulator(functions,'127.0.0.1',5008);
 }
 window.authEvents=[];window.legacyReads=0;
 window.state={id:'room-'+code,cloudCode:code,meta:{},matches:[]};
 window.currentAuthUid=()=>auth.currentUser?.uid;
 window.getMatch=id=>state.matches.find(m=>m.id===id);
 window.canOperateCurrentTournament=()=>auth.currentUser?.uid===sessionUid;
 window.requireStationPermission=match=>window.panel?.client.canScore(match.station)===true;
 window.applyRemoteState=(next)=>{if(next?.id===state.id&&auth.currentUser?.uid===sessionUid)window.state=next;};
 window.render=()=>{};window.showToast=text=>{const target=document.querySelector('.lab-toast');if(target)target.textContent=text;};
 window.stationMutationErrorMessage=reason=>reason;window.checkWinnerSide=()=>false;window.openModal=()=>{};window.finishTournament=async()=>{};window.pendingModal=null;window.cloudStatus='';window.cloudLastSyncAt=0;
 async function send(type,data){
  const token=await auth.currentUser.getIdToken();
  const response=await fetch('/auth/command',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({type,data})});return response.json();
 }
 function mount(){
  session?.stop();window.panel?.dispose();bridge?.close();session=null;bridge=null;sessionUid=auth.currentUser.uid;window.state={id:'room-'+code,cloudCode:code,meta:{},matches:[]};
  if(native){
   window.panel=BXHFourCourtLab.mount(document.getElementById('referee'),{transport:{projectId:db.app.options.projectId},code,uid:sessionUid,autoConnect:false,executeCommand:(matchId,command)=>executeRefereeSeatCommand(matchId,command),onView:view=>authEvents.push({uid:sessionUid,status:view.status,hasState:!!view.state}),clientFactory:receive=>{
    session=BXHFourCourtSession.create({enabled:true,db,auth,fs:sdk,authApi:sdk,functions,functionsApi:sdk,code,legacy:{joinRoom:async()=>{window.legacyReads++;throw Error('legacy-read-forbidden');}},onView:receive,onState:window.applyRemoteState});return session.client;
   }});session.start(window);
  }else{
  const transport=BXHFourCourtFirestore.create({db,auth,fs:sdk,authApi:sdk,commitScore:data=>send('score',data),manageSeats:data=>send('seat',data)});
  window.panel=BXHFourCourtLab.mount(document.getElementById('referee'),{transport,code,uid:sessionUid,onView:view=>{authEvents.push({uid:sessionUid,status:view.status,hasState:!!view.state});bridge?.publish(view);},executeCommand:(matchId,command)=>executeRefereeSeatCommand(matchId,command)});
  bridge=BXHFourCourtAppBridge.create({client:panel.client,code,uid:sessionUid,getUid:()=>auth.currentUser?.uid,legacy:{joinRoom:async()=>{window.legacyReads++;throw Error('legacy-read-forbidden');}}});
  window.cloudSync=bridge.cloud;bridge.cloud.subscribe(code,window.applyRemoteState);
  }
  document.getElementById('identity').textContent='已登入：'+sessionUid;
 }
 async function waitCleared(previous){const start=Date.now();while(previous?.client.getView().state!==null||previous?.client.getView().status!=='error'){if(Date.now()-start>10000)throw Error('old-auth-view-not-cleared');await new Promise(resolve=>setTimeout(resolve,10));}}
 document.getElementById('login').onclick=async()=>{
  document.getElementById('auth-error').textContent='';
  try{await persistence;const previous=window.panel,oldUid=sessionUid,uid=document.getElementById('account').value;await sdk.signInWithEmailAndPassword(auth,uid+'@bucket.invalid','Emulator-only-pass-2026');if(previous&&oldUid!==uid)await waitCleared(previous);mount();}catch(error){document.getElementById('auth-error').textContent=error.message;}
 };
 document.getElementById('logout').onclick=async()=>{
  const previous=window.panel;await sdk.signOut(auth);if(previous)await waitCleared(previous);session?.stop();bridge?.close();previous?.dispose();window.panel=null;sessionUid=null;window.state={id:'room-'+code,cloudCode:code,meta:{},matches:[]};document.getElementById('identity').textContent='未登入';
 };
 window.testFirebase={auth,db,sdk};
 window.testCallableChecks=async()=>{
  const url='http://127.0.0.1:5008/demo-bxh-four-court-buckets/asia-east1/commitBucketRefereeCommand',token=await auth.currentUser.getIdToken(),body=JSON.stringify({data:{code}});
  const noApp=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body});
  const noAuth=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Firebase-AppCheck':appCheckToken},body});
  return {missingAppCheck:noApp.status,missingAuth:noAuth.status};
 };
 window.testPlayerCallable=async()=>{try{await sdk.httpsCallable(functions,'commitBucketRefereeCommand')({code,action:'score',matchId:'m1',station:1,operationId:crypto.randomUUID(),uid:'ref1',auth:{uid:'ref1'}});return {ok:true};}catch(error){return {ok:false,code:error.code,reason:error.details?.reason};}};
})();
