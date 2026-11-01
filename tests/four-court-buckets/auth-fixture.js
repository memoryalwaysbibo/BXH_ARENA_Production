(function(){
 'use strict';
 const sdk=BXHBrowserSDK,code=new URL(location.href).searchParams.get('code');
 if(location.hostname!=='127.0.0.1'||!/^BXH-AUTH(6|12)$/.test(code))throw Error('emulator-only');
 const app=sdk.initializeApp({projectId:'demo-bxh-four-court-buckets',apiKey:'fake-emulator-key',authDomain:'demo-bxh-four-court-buckets.firebaseapp.com'}),auth=sdk.getAuth(app),db=sdk.getFirestore(app);
 sdk.connectAuthEmulator(auth,'http://127.0.0.1:9198',{disableWarnings:true});sdk.connectFirestoreEmulator(db,'127.0.0.1',8188);
 const persistence=sdk.setPersistence(auth,sdk.inMemoryPersistence);let bridge=null,sessionUid=null;
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
  window.panel?.dispose();bridge?.close();sessionUid=auth.currentUser.uid;window.state={id:'room-'+code,cloudCode:code,meta:{},matches:[]};
  const transport=BXHFourCourtFirestore.create({db,auth,fs:sdk,authApi:sdk,commitScore:data=>send('score',data),manageSeats:data=>send('seat',data)});
  window.panel=BXHFourCourtLab.mount(document.getElementById('referee'),{transport,code,uid:sessionUid,onView:view=>{authEvents.push({uid:sessionUid,status:view.status,hasState:!!view.state});bridge?.publish(view);},executeCommand:(matchId,command)=>executeRefereeSeatCommand(matchId,command)});
  bridge=BXHFourCourtAppBridge.create({client:panel.client,code,uid:sessionUid,getUid:()=>auth.currentUser?.uid,legacy:{joinRoom:async()=>{window.legacyReads++;throw Error('legacy-read-forbidden');}}});
  window.cloudSync=bridge.cloud;bridge.cloud.subscribe(code,window.applyRemoteState);
  document.getElementById('identity').textContent='已登入：'+sessionUid;
 }
 async function waitCleared(previous){const start=Date.now();while(previous?.client.getView().state!==null||previous?.client.getView().status!=='error'){if(Date.now()-start>10000)throw Error('old-auth-view-not-cleared');await new Promise(resolve=>setTimeout(resolve,10));}}
 document.getElementById('login').onclick=async()=>{
  document.getElementById('auth-error').textContent='';
  try{await persistence;const previous=window.panel,oldUid=sessionUid,uid=document.getElementById('account').value;await sdk.signInWithEmailAndPassword(auth,uid+'@bucket.invalid','Emulator-only-pass-2026');if(previous&&oldUid!==uid)await waitCleared(previous);mount();}catch(error){document.getElementById('auth-error').textContent=error.message;}
 };
 document.getElementById('logout').onclick=async()=>{
  const previous=window.panel;await sdk.signOut(auth);if(previous)await waitCleared(previous);bridge?.close();previous?.dispose();window.panel=null;sessionUid=null;window.state={id:'room-'+code,cloudCode:code,meta:{},matches:[]};document.getElementById('identity').textContent='未登入';
 };
 window.testFirebase={auth,db,sdk};
})();
