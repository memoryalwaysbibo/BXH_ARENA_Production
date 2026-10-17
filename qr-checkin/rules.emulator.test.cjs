'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,writeBatch,deleteDoc}=require('firebase/firestore');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8091')throw Error('Dedicated local emulator required');
let env,serial=0;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-qr-checkin',firestore:{host:'127.0.0.1',port:8091,rules:fs.readFileSync(__dirname+'/firestore.candidate.rules','utf8')}});});
after(async()=>{await env?.cleanup();});
async function fixture(managed=true,testEnv=env){
 const code='BXH-RULE'+String(++serial).padStart(4,'0');
 const state={players:[],meta:{name:'Rules fixture',checkinRequired:true}};
 const common={eventAuthority:'official',createdBy:'manager',ownerUid:'manager',createdByRole:'super_admin',assignedStaffUids:['manager'],visibility:'public',ladderMode:'general',tournamentPhase:'waiting',archiveStatus:'ongoing',registrationEnabled:false,registrationStatus:'closed',confirmedCount:0,waitlistCount:0,updatedAt:1};
 const extra=managed?{qrCheckinManaged:true,qrCheckinRevision:3}:{};
 if(managed){state.qrCheckinManaged=true;state.qrCheckinRevision=3;}
 await testEnv.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();await setDoc(doc(db,'users/manager'),{role:'super_admin',active:true});await setDoc(doc(db,'users/player'),{role:'player',active:true});
  await setDoc(doc(db,'tournaments/'+code),{...common,...extra,...(managed?{qrCheckin:{enabled:true,session:'s1'}}:{}),data:JSON.stringify(state)});
  await setDoc(doc(db,'publicTournaments/'+code),{...common,...extra,bracketView:JSON.stringify({players:[]})});
 });
 const db=testEnv.authenticatedContext('manager').firestore();
 function batch({privateRevision=4,publicRevision=4,uid='manager',privateOnly=false,publicOnly=false,includeRevision=managed,changeState=true}={}){
  const db=testEnv.authenticatedContext(uid).firestore(),b=writeBatch(db),marker=changeState?{marker:'new'}:{};
  if(!publicOnly)b.update(doc(db,'tournaments/'+code),{data:JSON.stringify({...state,...marker,...(includeRevision?{qrCheckinRevision:privateRevision}:{})}),updatedAt:2,...(includeRevision?{qrCheckinRevision:privateRevision}:{})});
  if(!privateOnly)b.update(doc(db,'publicTournaments/'+code),{bracketView:JSON.stringify({players:[],...marker}),updatedAt:2,...(includeRevision?{qrCheckinRevision:publicRevision}:{})});
  return b.commit();
 }
 return {code,db,state,batch};
}
test('existing unmanaged administrator save remains allowed',async()=>{const x=await fixture(false);await assertSucceeds(x.batch({includeRevision:false}));});
test('unmanaged metadata-only save has the same outcome as exact Production baseline',async()=>{
 const baseline=await initializeTestEnvironment({projectId:'demo-qr-checkin-baseline',firestore:{host:'127.0.0.1',port:8091,rules:fs.readFileSync(__dirname+'/reference/firestore.production-20261016.rules','utf8')}});
 const outcome=async x=>{try{await x.batch({includeRevision:false,changeState:false});return 'allowed';}catch(e){assert.equal(e.code,'permission-denied');return 'denied';}};
 try{
  const original=await outcome(await fixture(false,baseline));
  const candidate=await outcome(await fixture(false));
  assert.equal(candidate,original,'QR guard changed the legacy metadata-only result');
  console.log('Metadata-only baseline/candidate:',original+'/'+candidate);
 }finally{await baseline.cleanup();}
});
test('managed administrator save advances both matching revisions',async()=>{const x=await fixture();await assertSucceeds(x.batch());assert.equal((await getDoc(doc(x.db,'tournaments/'+x.code))).data().qrCheckinRevision,4);});
test('old client cannot overwrite either managed mirror without a revision',async()=>{const x=await fixture();await assertFails(x.batch({includeRevision:false}));});
test('private-only and public-only counter advances are denied',async()=>{const x=await fixture();await assertFails(x.batch({privateOnly:true}));await assertFails(x.batch({publicOnly:true}));});
test('mismatched mirror counters are denied atomically',async()=>{const x=await fixture();await assertFails(x.batch({publicRevision:5}));assert.equal((await getDoc(doc(x.db,'tournaments/'+x.code))).data().qrCheckinRevision,3);});
test('ordinary player cannot gain management access by including valid QR counters',async()=>{const x=await fixture();await assertFails(x.batch({uid:'player'}));});
test('client cannot activate QR management or replace the server QR session',async()=>{
 const x=await fixture(false);await assertFails(setDoc(doc(x.db,'tournaments/'+x.code),{qrCheckinManaged:true,qrCheckinRevision:1},{merge:true}));
 const y=await fixture();await assertFails(setDoc(doc(y.db,'tournaments/'+y.code),{qrCheckin:{enabled:true,session:'forged'}},{merge:true}));
});
test('receipt, audit and operation documents remain server-only even for administrator clients',async()=>{
 const x=await fixture();for(const collection of ['checkinReceipts','checkinAudit','checkinOperations']){
  const ref=doc(x.db,'tournaments/'+x.code+'/'+collection+'/forged');await assertFails(setDoc(ref,{actorUid:'manager',checkedIn:true}));await assertFails(getDoc(ref));
 }
});
test('managed room cannot bypass audit protection through direct client deletion',async()=>{const x=await fixture();await assertFails(deleteDoc(doc(x.db,'tournaments/'+x.code)));await assertFails(deleteDoc(doc(x.db,'publicTournaments/'+x.code)));});
