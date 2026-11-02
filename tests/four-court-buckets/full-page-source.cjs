'use strict';
// Test server adapter only. Serve the entire shipped page/core; redirect SDK
// dependencies to loopback Emulators without editing deployable source bytes.
const assert=require('node:assert/strict');
const project='demo-bxh-four-court-buckets';
function once(source,from,to){assert.equal(source.split(from).length,2,'full-page adapter source anchor changed: '+from.slice(0,90));return source.replace(from,to);}
function build(source){
 source=once(source,'const FOUR_COURT_CLIENT_ROLLOUT = false;','const FOUR_COURT_CLIENT_ROLLOUT = true;');
 const config=source.match(/  const FIREBASE_CONFIG = \{[\s\S]*?\n  \};/);assert(config);
 source=once(source,config[0],`  const FIREBASE_CONFIG = ${JSON.stringify({apiKey:'fake-emulator-key',authDomain:'localhost',projectId:project,appId:'1:123456:web:bucket-emulator'})};`);
 source=once(source,'FIREBASE_CONFIG.projectId === "bxh-arena"',`FIREBASE_CONFIG.projectId === "${project}"`);
 for(const name of ['app','firestore','auth','functions','app-check']){
  const from='await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-'+name+'.js`)';
  // app also appears in an unrelated managed-account creation path. Replace
  // every occurrence of these exact SDK imports, never arbitrary imports.
  assert(source.includes(from),'SDK anchor missing: '+name);source=source.split(from).join('await Promise.resolve(window.BXHFullPageLab.sdk)');
 }
 source=once(source,'dbHandle = fsMod.getFirestore(app);','dbHandle = fsMod.getFirestore(app); fsMod.connectFirestoreEmulator(dbHandle,"127.0.0.1",8188);');
 source=once(source,'functionsHandle = functionsMod.getFunctions(app,"asia-east1");','functionsHandle = functionsMod.getFunctions(app,"asia-east1"); functionsMod.connectFunctionsEmulator(functionsHandle,"127.0.0.1",5008);');
 source=once(source,'persistence: [authMod.browserLocalPersistence, authMod.browserSessionPersistence]\n        });','persistence: [authMod.browserLocalPersistence, authMod.browserSessionPersistence]\n        }); authMod.connectAuthEmulator(authHandle,"http://127.0.0.1:9198",{disableWarnings:true});');
 source=once(source,'new mod.ReCaptchaEnterpriseProvider(ARENA_APP_CHECK_SITE_KEY)','new mod.CustomProvider({getToken:window.BXHFullPageLab.appCheckToken})');
 return 'if(location.hostname!=="127.0.0.1"||!window.BXHFullPageLab)throw Error("emulator-only");\n'+source;
}
const boot=`(function(){
 if(location.hostname!=="127.0.0.1")throw Error('emulator-only');
 const sdk=BXHFullPageSDK,wire=[];window.dropNextBucketReply=false;
 window.BXHFullPageLab={wire,sdk:{...sdk,httpsCallable(handle,name,options){const invoke=sdk.httpsCallable(handle,name,options);return async data=>{
  wire.push({name,data:JSON.parse(JSON.stringify(data))});const result=await invoke(data);
  if(name==='commitBucketRefereeCommand'&&window.dropNextBucketReply){window.dropNextBucketReply=false;throw Object.assign(Error('lost-success-reply'),{code:'functions/unavailable'});}return result;
 };}},async appCheckToken(){
  const encode=v=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_'),now=Math.floor(Date.now()/1000);
  // Unsigned protocol fixture accepted only by Functions Emulator. This is
  // deliberately not evidence of real Enterprise App Check attestation.
  return {token:encode({alg:'none',typ:'JWT'})+'.'+encode({sub:'1:123456:web:bucket-emulator',aud:['projects/123456'],iss:'https://firebaseappcheck.googleapis.com/123456',iat:now,exp:now+3600})+'.',expireTimeMillis:(now+3600)*1000};
 }};
})();`;
module.exports={build,boot,project};
