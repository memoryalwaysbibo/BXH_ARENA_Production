'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore'),{doc,setDoc,getDocFromServer,getDocs,collection}=sdk;
const B=require('../../referee-seats/functions/bucket-state.cjs'),{fixture}=require('./trusted-fixture.cjs');
const {create}=require('../../modules/scoring/four-court-firestore-transport.cjs'),{create:createClient}=require('../../modules/scoring/four-court-client.cjs');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
async function until(check,message){const start=Date.now();while(!check()){if(Date.now()-start>15000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,25));}}
(async()=>{
 const env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host:'127.0.0.1',port:8188,rules:fs.readFileSync(path.resolve(__dirname,'../../referee-seats/firestore.candidate.rules'),'utf8')}});
 const clients=[],report={kind:'bucket-web-sdk-rules',productionWrites:0,cases:[]};
 const admin=fn=>env.withSecurityRulesDisabled(context=>fn(context.firestore()));
 try{
  for(const [uid,profile]of Object.entries({ref1:{active:true,role:'staff'},unseated:{active:true,role:'staff'},admin:{active:true,role:'super_admin'},player:{active:true,role:'player'},disabled:{active:false,role:'staff'},tester:{active:true,role:'staff',isTestAccount:true}}))await admin(db=>setDoc(doc(db,'users',uid),profile));
  await admin(db=>setDoc(doc(db,'systemConfig','fourCourtScoreBuckets'),{enabled:true,privateReadsEnabled:true}));
  for(const count of [6,12]){
   const code='BXH-WEBREAD'+count,f=fixture(code,count,false),encoded=B.encode(f.state,f.room.scoreStorage);
   await admin(async db=>{await setDoc(doc(db,'tournaments',code),f.room);for(const bucket of encoded)await setDoc(doc(db,'tournaments',code,'matchBuckets',bucket.bucketId),bucket);});
   const db=env.authenticatedContext('ref1').firestore(),auth={currentUser:{uid:'ref1'}},authListeners=new Set();
   const authApi={onAuthStateChanged(_auth,next){authListeners.add(next);queueMicrotask(()=>{if(authListeners.has(next))next(auth.currentUser);});return ()=>authListeners.delete(next);}};
   const transport=create({db,auth,fs:sdk,authApi,commitScore:async()=>({ok:false,reason:'not-wired'}),manageSeats:async()=>({ok:false,reason:'not-wired'})});
   const client=createClient({transport,code,uid:'ref1',operationId:()=> 'reader-operation-0001'});clients.push(client);client.connect();
   await until(()=>client.getView().status==='ready','Web SDK did not synchronize '+count);
   assert.equal(client.getView().state.matches.length,count);
   f.state.matches[0].scoreA=2;f.state.matches[0].refereeSeatScoreRevision=1;
   const updated=B.encode(f.state,f.room.scoreStorage,encoded)[0];await admin(db=>setDoc(doc(db,'tournaments',code,'matchBuckets','court-1'),updated));
   await until(()=>client.getView().state?.matches[0].scoreA===2,'bucket subscription missed update');
   assert(client.getView().state.matches.slice(1).every(m=>m.scoreA===0));
   for(const uid of ['admin','unseated'])await assertSucceeds(getDocFromServer(doc(env.authenticatedContext(uid).firestore(),'tournaments',code,'matchBuckets','court-1')));
   for(const context of [env.unauthenticatedContext(),...['player','disabled','tester'].map(uid=>env.authenticatedContext(uid))])await assertFails(getDocFromServer(doc(context.firestore(),'tournaments',code,'matchBuckets','court-1')));
   await assertFails(getDocs(collection(db,'tournaments',code,'matchBuckets')));
   await assertFails(setDoc(doc(env.authenticatedContext('admin').firestore(),'tournaments',code,'matchBuckets','court-1'),updated));
   // A seat revocation changes scoring authority, while staff retain read access.
   f.room.refereeSeatsV1.courts['1'].main=null;f.room.updatedAt++;
   await admin(db=>setDoc(doc(db,'tournaments',code),f.room));
   await until(()=>client.getView().state?.meta.refereeSeatsV1.courts['1'].main===null,'seat revocation missed');
   assert.equal(client.canScore(1),false);assert.equal(client.getView().state.matches[0].scoreA,2);
   // Explicit profile subscription closes existing reads, including an SDK
   // target that can briefly reuse a previously server-confirmed snapshot.
   await admin(db=>setDoc(doc(db,'users','ref1'),{active:false,role:'staff'}));
   await until(()=>client.getView().status==='error','deactivation did not terminate subscription');
   await assertFails(getDocFromServer(doc(env.authenticatedContext('ref1').firestore(),'tournaments',code,'matchBuckets','court-1')));
   assert.equal((await transport.commitScore({})).reason,'profile-access-revoked');
   await admin(db=>setDoc(doc(db,'users','ref1'),{active:true,role:'staff'}));client.connect();
   await until(()=>client.getView().status==='ready','reactivated reconnect failed');
   auth.currentUser=null;for(const callback of [...authListeners])callback(null);
   assert.equal(client.getView().status,'error');assert.equal((await transport.commitScore({})).reason,'auth-changed');
   client.disconnect();
   report.cases.push({courts:count,buckets:Math.ceil(count/4),webSdkSubscription:true,seatRevocationReadOnly:true,profileRevocationStopsRead:true,signOutStopsRead:true,unauthorizedReadsDenied:true,clientWritesDenied:true,listDenied:true});
  }
  const code='BXH-WEBREAD6',ref=()=>doc(env.authenticatedContext('admin').firestore(),'tournaments',code,'matchBuckets','court-1');
  await admin(db=>setDoc(doc(db,'systemConfig','fourCourtScoreBuckets'),{enabled:true,privateReadsEnabled:false}));await assertFails(getDocFromServer(ref()));
  await admin(db=>setDoc(doc(db,'systemConfig','fourCourtScoreBuckets'),{enabled:true,privateReadsEnabled:true}));
  const f=fixture(code,6,false),bucket=B.encode(f.state,f.room.scoreStorage)[0];
  await admin(db=>setDoc(doc(db,'tournaments',code,'matchBuckets','court-1'),{...bucket,epoch:'wrong-epoch'}));await assertFails(getDocFromServer(ref()));
  await admin(db=>setDoc(doc(db,'tournaments',code,'matchBuckets','court-1'),bucket));
  f.room.createdByRole='partner_organizer';await admin(db=>setDoc(doc(db,'tournaments',code),f.room));await assertFails(getDocFromServer(ref()));
  delete f.room.createdByRole;f.room.scoreStorage.status='preparing';await admin(db=>setDoc(doc(db,'tournaments',code),f.room));await assertFails(getDocFromServer(ref()));
  report.cases.push({readFlagOffDenied:true,wrongEpochDenied:true,partnerRoomDenied:true,inactiveManifestDenied:true});
  const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'reader-rules.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS Web SDK bucket reads: '+JSON.stringify(report));
 }finally{for(const client of clients)client.disconnect();await env.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
