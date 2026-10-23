'use strict';
/** Private DATA-01B -> real Firestore Emulator -> Taiwan review HTTP adapter.
 * --real-auth uses Firebase Auth Emulator; default Auth is a test double.
 * --real-http uses the actual v2 onRequest SDK over loopback HTTP/Express.
 * App Check remains a test double; no deployed services or Functions Emulator.
 * No fixture contents are printed or committed. No production initialization.
 */
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {createData01bEmulatorLoader}=require('../../modules/bey-catalog/catalog-data01b-private-emulator-loader.cjs');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {planStaging}=require('../../modules/bey-catalog/catalog-staging.cjs');
const {resumeEmulatorBatch,manifestDigest}=require('../../modules/bey-catalog/catalog-emulator-batch.cjs');
const {deriveTaiwanTw04}=require('../../modules/bey-catalog/catalog-tw04-corrections.cjs');
const {applyTw05ColorLabels}=require('../../modules/bey-catalog/catalog-tw05-colors.cjs');
const {buildTw06ReviewQueue}=require('../../modules/bey-catalog/catalog-tw06-review-queue.cjs');
const {createTw13HttpV2Handler}=require('../../modules/bey-catalog/catalog-tw13-http-v2.cjs');
const {createTw15AdminEmulatorGuards,WINDOW_MS}=require('../../modules/bey-catalog/catalog-tw15-admin-emulator.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
const EXPECTED_SHA='2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42';
const EXPECTED_MANIFEST='e8fa4337fa76bd13ebc372ff91e611d03fcd4ccd5ec91623be21f5dabc5992f0';
const sections={sources:['beySources','sourceId',23],products:['beyProducts','productId',9],parts:['beyParts','partId',45],variants:['beyPartVariants','variantId',11],colors:['beyColors','colorId',9],options:['beyProductOptions','optionId',14],assemblyClaims:['beyAssemblyClaims','groupId',16],contentClaims:['beyPackageContents','contentClaimId',52],issues:['beyCatalogIssues','issueId',18]};
function readPrivateFixture(){
 const file=process.env.BXH_CATALOG_DATA01B_FILE;
 if(!file)throw Error('DATA01B_FILE_REQUIRED');
 const raw=fs.readFileSync(file);
 assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),EXPECTED_SHA,'original fixture checksum');
 const base=JSON.parse(raw);
 assert.equal(base.batchId,'DATA-01B-20261009');
 assert.equal(base.productionWritable,false);assert.equal(base.autoPublish,false);
 for(const [section,[,,count]] of Object.entries(sections))assert.equal(base[section].length,count);
 const plan=planStaging(base);
 assert.equal(plan.recordCount,197);assert.equal(manifestDigest(plan),EXPECTED_MANIFEST);
 return {file,raw,base,plan};
}
async function main({realAuth=false,realHttp=false}={}){
 if(process.env.FIRESTORE_EMULATOR_HOST!==target.emulatorHost)throw Error('LOCAL_EMULATOR_REQUIRED');
 if(realAuth&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('LOCAL_AUTH_EMULATOR_REQUIRED');
 if(realHttp&&!realAuth)throw Error('REAL_HTTP_REQUIRES_REAL_AUTH');
 const {file,raw,base,plan}=readPrivateFixture();
 const env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});
 const app=initializeApp({projectId:target.projectId},'data01b-taiwan-real');
 const db=getFirestore(app);
 const actor='data01b_tw_admin',player='data01b_tw_player';
 const secret='data01b-taiwan-emulator-only-audit-key';
 let researchLoads=0,transport;
 let adminToken='admin-test-token',playerToken='player-test-token',anonymousToken;
 const auth=realAuth?getAuth(app):null;
 try{
  if(realAuth){
   assert.equal((await auth.listUsers()).users.length,0,'clean Auth Emulator required');
   const password='Emulator-only-password-20261009';
   async function authPost(method,body){
    const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:'+method+'?key=emulator-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal(r.status,200,'Auth Emulator REST login');return r.json();
   }
   for(const uid of [actor,player])await auth.createUser({uid,email:uid+'@example.invalid',password});
   adminToken=(await authPost('signInWithPassword',{email:actor+'@example.invalid',password,returnSecureToken:true})).idToken;
   playerToken=(await authPost('signInWithPassword',{email:player+'@example.invalid',password,returnSecureToken:true})).idToken;
   anonymousToken=(await authPost('signUp',{returnSecureToken:true})).idToken;
   assert.equal((await auth.verifyIdToken(adminToken,true)).uid,actor);
  }
  for(const collection of [...Object.values(sections).map(s=>s[0]),'beyCatalogImportRuns','users','beyCatalogTw15Quota','beyCatalogTw15Audit'])assert.equal((await db.collection(collection).get()).size,0,'clean Emulator required');
  await env.withSecurityRulesDisabled(async ctx=>{
   const imported=await resumeEmulatorBatch(ctx.firestore(),target,plan);
   assert.equal(imported.inserted,197);assert.equal(imported.published,0);
  });
  const loader=createData01bEmulatorLoader({db,target,fixtureFile:file});
  const loadStoredOriginal=loader.loadOriginal;
  const originalSnapshot=await loadStoredOriginal();
  const derived=applyTw05ColorLabels(deriveTaiwanTw04(originalSnapshot));
  const queue=buildTw06ReviewQueue(derived);
  assert.deepEqual(queue.summary,{total:31,P0:5,P1:15,P2:11});
  assert(queue.items.some(i=>i.recordId==='part_000022'&&i.reasonCode==='TAIWAN_PART_NAME_PENDING'));
  assert(queue.items.every(i=>i.reviewState==='pending'&&!i.evidenceVerified&&!i.canAutoPublish));
  assert.equal(derived.contentClaims.find(c=>c.contentClaimId==='content_000019').partId,'part_000013');
  for(const id of ['part_000034','part_000037']){
   const p=derived.parts.find(p=>p.partId===id);assert.equal(p.localizationStatus,'taiwan_name_pending');
   assert(!p.aliases.some(a=>['九尾','焰神'].includes(a)));
  }
  assert(derived.colors.every(c=>c.displayHex===null&&!c.physicalColorVerified));
  assert(derived.parts.every(p=>p.selectable===false));
  assert(derived.variants.every(v=>v.selectable===false&&v.canAutoPublish===false));
  await db.collection('users').doc(actor).set({role:'super_admin',active:true,isTestAccount:false});
  await db.collection('users').doc(player).set({role:'player',active:true,isTestAccount:false});
  let quotaClock=WINDOW_MS*99002;
  const guards=createTw15AdminEmulatorGuards({db,target,Timestamp,FieldValue,secret,clock:()=>quotaClock});
  const dependencies={allowedAppIds:['data01b-test-app'],
   adminAppCheck:{verifyToken:async token=>{if(token!=='test-app')throw Error('INVALID_APP_CHECK');return {appId:'data01b-test-app'};}},
   adminAuth:auth||{verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);assert(['admin-test-token','player-test-token'].includes(token));return {uid:token==='admin-test-token'?actor:player,firebase:{sign_in_provider:'password'}};}},
   adminFirestore:db,loadResearchBatch:async()=>{researchLoads++;return loader.loadResearchBatch();},
   consumeRateLimit:guards.consumeRateLimit,recordAudit:guards.recordAudit};
  const handler=createTw13HttpV2Handler({onRequest:realHttp?require('firebase-functions/v2/https').onRequest:(options,fn)=>fn,dependencies,allowedOrigins:['https://arena.bxh.com.tw']});
  if(realHttp)transport=await require('./http-loopback.cjs').startLoopbackHttp(handler);
  async function request(body={},token=adminToken,appToken='test-app'){
   if(transport)return transport.request({body,headers:{origin:'https://arena.bxh.com.tw',authorization:'Bearer '+token,'x-firebase-appcheck':appToken}});
   const response={headers:{},set(k,v){this.headers[k]=v;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};
   await handler({method:'POST',headers:{origin:'https://arena.bxh.com.tw','content-type':'application/json',authorization:'Bearer '+token,'x-firebase-appcheck':appToken},body},response);
   return response;
  }
  if(transport){
   const headers={origin:'https://arena.bxh.com.tw'};
   const preflight=await transport.request({method:'OPTIONS',headers});assert.equal(preflight.code,204);
   assert.equal(preflight.headers['access-control-allow-origin'],headers.origin);
   assert.equal((await transport.request({method:'GET',headers})).code,405);
   assert.equal((await transport.request({headers:{origin:'https://untrusted.example'},body:{}})).code,403);
   for(const body of ['{invalid-json',JSON.stringify({query:'x'.repeat(5000)})]){
    const r=await transport.request({headers,body});assert.equal(r.code,400);assert.deepEqual(r.body,{error:'INVALID_REQUEST'});
   }
   assert.equal(researchLoads,0);
  }
  const seen=[];let cursor=null;
  do{
   const r=await request({limit:10,cursor});assert.equal(r.code,200);
   assert.deepEqual({total:r.body.summary.total,P0:r.body.summary.P0,P1:r.body.summary.P1,P2:r.body.summary.P2},queue.summary);
   assert.equal(r.body.canApprove,false);assert.equal(r.body.canPublish,false);
   assert.equal((r.headers['Cache-Control']||r.headers['cache-control']),'no-store');seen.push(...r.body.items);cursor=r.body.nextCursor;
  }while(cursor);
  assert.equal(seen.length,31);assert.equal(new Set(seen.map(i=>i.queueId)).size,31);
  assert.deepEqual(seen.map(i=>i.queueId).sort(),queue.items.map(i=>i.queueId).sort());
  const p0=await request({filter:'P0',limit:10});assert.equal(p0.code,200);assert.equal(p0.body.items.length,5);
  assert.equal((await request()).code,429);
  assert.equal(researchLoads,5);
  assert.equal((await request({},playerToken)).code,403);assert.equal(researchLoads,5);
  assert.equal((await request({},adminToken,'bad-app')).code,403);assert.equal(researchLoads,5);
  if(realAuth){
   assert.equal((await request({},anonymousToken)).code,401,'anonymous ID token');
   assert.equal((await request({},'not-a-valid-jwt')).code,401,'malformed ID token');
   const pieces=adminToken.split('.');
   const claims=JSON.parse(Buffer.from(pieces[1],'base64url'));
   const invalidAudience=[pieces[0],Buffer.from(JSON.stringify({...claims,aud:'demo-other-project'})).toString('base64url'),pieces[2]].join('.');
   assert.equal((await request({},invalidAudience)).code,401,'wrong audience');
   await auth.updateUser(player,{disabled:true});
   assert.equal((await request({},playerToken)).code,401,'disabled account');
   await new Promise(resolve=>setTimeout(resolve,1200));
   await auth.revokeRefreshTokens(actor);
   assert.equal((await request({},adminToken)).code,401,'revoked ID token');
   assert.equal(researchLoads,5,'denied auth must not load research');
  }
  const audits=await db.collection('beyCatalogTw15Audit').get();
  const hash=uid=>crypto.createHmac('sha256',secret).update('actor\0'+uid).digest('hex');
  assert.equal(audits.docs.filter(d=>d.data().actorHash===hash(actor)&&d.data().outcome==='preview').length,5);
  assert.equal(audits.docs.filter(d=>d.data().actorHash===hash(player)&&d.data().outcome==='denied').length,1);
  assert(audits.docs.every(d=>d.data().emulatorOnly===true&&d.data().recordedAt instanceof Timestamp));
  let corruptionCases=0;
  const record=plan.records[0],recordRef=db.collection(record.collection).doc(record.id);
  const savedRecord=(await recordRef.get()).data();
  const runRef=db.collection('beyCatalogImportRuns').doc(base.batchId),savedRun=(await runRef.get()).data();
  async function rejectChanged(change,restore,error){
   await change();
   try{
    await assert.rejects(loader.loadOriginal,error);
    if(!realAuth){
     quotaClock+=WINDOW_MS;
     const response=await request();assert.equal(response.code,503);
     assert.deepEqual(response.body,{error:'SERVICE_UNAVAILABLE'});
    }
    corruptionCases++;
   }finally{await restore();}
  }
  await rejectChanged(()=>recordRef.set({...savedRecord,payload:{...savedRecord.payload,manualReviewNote:'emulator tamper check'}}),()=>recordRef.set(savedRecord),/DATA01B_LOADER_DOCUMENT_MISMATCH/);
  await rejectChanged(()=>recordRef.update({publicationStatus:'published'}),()=>recordRef.set(savedRecord),/DATA01B_LOADER_DOCUMENT_MISMATCH/);
  await rejectChanged(()=>runRef.update({status:'in_progress'}),()=>runRef.set(savedRun),/DATA01B_LOADER_BATCH_NOT_VERIFIED/);
  await rejectChanged(()=>runRef.update({status:'completed_with_conflicts',conflicts:1}),()=>runRef.set(savedRun),/DATA01B_LOADER_BATCH_NOT_VERIFIED/);
  await rejectChanged(()=>runRef.update({manifestDigest:'wrong-manifest'}),()=>runRef.set(savedRun),/DATA01B_LOADER_BATCH_NOT_VERIFIED/);
  const extra=db.collection(record.collection).doc('emulator_extra');
  await rejectChanged(()=>extra.set(savedRecord),()=>extra.delete(),/DATA01B_LOADER_COLLECTION_COUNT_MISMATCH/);
  await rejectChanged(()=>recordRef.delete(),()=>recordRef.set(savedRecord),/DATA01B_LOADER_COLLECTION_COUNT_MISMATCH/);
  assert.deepEqual(await loadStoredOriginal(),originalSnapshot);
  assert.deepEqual(fs.readFileSync(file),raw);
  console.log(JSON.stringify({batchId:base.batchId,originalSha256:EXPECTED_SHA,manifestDigest:EXPECTED_MANIFEST,verifiedDocuments:197,corruptionCases,consistentSnapshot:true,reviewQueue:queue.summary,paginatedItems:seen.length,adminRequests:5,rateLimitStatus:429,playerStatus:403,researchLoads,originalPreserved:true,published:0,cloudWrites:0,emulator:true,auth:realAuth?'firebase-auth-emulator':'test-double',authCases:realAuth?['login','anonymous','malformed','wrong-audience','disabled','revoked']:[],appCheck:'test-double',http:realHttp?'loopback-http-real-v2-sdk':'in-process-handler',transportCases:realHttp?['cors-preflight','method','origin','malformed-json','oversized-json']:[]}));
 }finally{if(transport)await transport.close();await deleteApp(app);await env.cleanup();}
}
if(require.main===module)main({realAuth:process.argv.includes('--real-auth'),realHttp:process.argv.includes('--real-http')}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
