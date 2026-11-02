(function(){
 'use strict';
 if(location.hostname!=='127.0.0.1')throw Error('emulator-only');
 const sdk=BXHBrowserSDK,code=new URL(location.href).searchParams.get('code');if(!/^BXH-AUTH(6|12)$/.test(code))throw Error('emulator-only');
 const app=sdk.initializeApp({projectId:'demo-bxh-four-court-buckets',apiKey:'fake-emulator-key',appId:'1:123456:web:bucket-emulator'}),auth=sdk.getAuth(app),db=sdk.getFirestore(app),functions=sdk.getFunctions(app,'asia-east1');
 sdk.connectAuthEmulator(auth,'http://127.0.0.1:9198',{disableWarnings:true});sdk.connectFirestoreEmulator(db,'127.0.0.1',8188);sdk.connectFunctionsEmulator(functions,'127.0.0.1',5008);
 const encode=value=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'),now=Math.floor(Date.now()/1000);
 const token=encode({alg:'none',typ:'JWT'})+'.'+encode({sub:'1:123456:web:bucket-emulator',aud:['projects/123456'],iss:'https://firebaseappcheck.googleapis.com/123456',iat:now,exp:now+3600})+'.';
 // Emulator-only protocol fixture; not production App Check attestation.
 sdk.initializeAppCheck(app,{provider:new sdk.CustomProvider({getToken:async()=>({token,expireTimeMillis:(now+3600)*1000})}),isTokenAutoRefreshEnabled:false});
 window.defaultState=id=>({id,meta:{},matches:[],players:[]});window.state={...defaultState('room-'+code),cloudCode:code};window.cloudStatus='';window.render=()=>{document.getElementById('status').textContent=cloudStatus;if(window.refereeSyncRecoveryControlsHtml)document.getElementById('retry-controls').innerHTML=refereeSyncRecoveryControlsHtml();};
 window.currentAuthUid=()=>auth.currentUser?.uid;window.canUseRefereeSyncRecovery=()=>!!auth.currentUser;window.BXHRefereeSyncRecovery={isBusy:()=>false};window.applyRemoteState=next=>{window.state=next;render();};window.showToast=()=>{};window.openModal=()=>{throw Error('legacy-reload-forbidden');};
 installBucketMainStatus();installBucketRetryControls();let stop=()=>{};
 document.getElementById('retry-controls').onclick=event=>{const action=event.target.dataset.action;if(action==='referee-bucket-retry')void retryRefereeBucketOperations();if(action==='referee-sync-recovery')requestRefereeSyncRecovery();};
 window.dropNextBucketReply=false;window.bucketWireCommands=[];
 const routedSdk={...sdk,httpsCallable:(handle,name,options)=>{const invoke=sdk.httpsCallable(handle,name,options);return async data=>{if(name==='commitBucketRefereeCommand')bucketWireCommands.push(JSON.parse(JSON.stringify(data)));const result=await invoke(data);if(window.dropNextBucketReply&&name==='commitBucketRefereeCommand'){window.dropNextBucketReply=false;throw Object.assign(Error('lost-success-reply'),{code:'functions/unavailable'});}return result;};}};
 window.lifecycleTest={auth,db,sdk,code,
  async login(uid){await sdk.signInWithEmailAndPassword(auth,uid+'@bucket.invalid','Emulator-only-pass-2026');},
  install(enabled=true){installBucketCloudRoute({auth,db,sdk:routedSdk,functions,enabled});},
  subscribe(){stop();stop=cloudSync.subscribe(code,(next)=>{window.state=next;});},
  unsubscribe(){stop();},
  async score(){const match=state.matches[0],court=state.meta.refereeSeatsV1.courts[match.station];return cloudSync.commitRefereeCommand({code,matchId:match.id,station:match.station,action:'score',side:'B',finish:'spin',operationId:crypto.randomUUID(),expectedCourtRevision:court.revision,expectedScoreRevision:match.refereeSeatScoreRevision||0,expectedDispatchRevision:match.dispatchRevision||0,playerAId:match.a.playerId,playerBId:match.b.playerId});}
 };
})();
