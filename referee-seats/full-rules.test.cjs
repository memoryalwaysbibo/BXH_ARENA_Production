'use strict';
const {test,before,after}=require('node:test'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,writeBatch,collection,getDocs,Timestamp}=require('firebase/firestore');
let env;
const code='BXH-FULLSEATS',common={eventAuthority:'official',createdBy:'host',ownerUid:'host',createdByRole:'staff',assignedStaffUids:['host','seated','unseated'],visibility:'public',ladderMode:'general',tournamentPhase:'waiting',archiveStatus:'ongoing',registrationEnabled:false,registrationStatus:'closed',confirmedCount:0,waitlistCount:0,updatedAt:1};
const state={id:'full-rule-fixture',meta:{name:'Full seat rules fixture',eventAuthority:'official',stations:1},players:[],matches:[]};
before(async()=>{
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8197')throw Error('dedicated local emulator required');
 const rulesPath=process.env.REFEREE_RULES_PATH||__dirname+'/firestore.candidate.rules';
 env=await initializeTestEnvironment({projectId:'demo-referee-seat-full-rules',firestore:{host:'127.0.0.1',port:8197,rules:fs.readFileSync(rulesPath,'utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await Promise.all(['host','seated','unseated','admin','player'].map(uid=>setDoc(doc(db,'users/'+uid),{active:true,isTestAccount:false,role:uid==='admin'?'admin':uid==='player'?'player':'staff'})));
  await setDoc(doc(db,'tournaments/'+code),{...common,data:JSON.stringify(state),refereeSeatsV1:{version:1,revision:1,courts:{1:{revision:1,main:{uid:'seated',name:'裁判'},backup1:null,backup2:null}},requests:{}},refereeSeatNames:{1:{main:{name:'裁判'},backup1:null,backup2:null}},refereeStationAssignments:{1:['host','seated']},refereeStationNames:{1:['裁判']},refereeStationUids:['seated'],refereeStationRestrictionEnabled:true});
  await setDoc(doc(db,'publicTournaments/'+code),{...common,bracketView:JSON.stringify(state)});
 });
});
after(async()=>env?.cleanup());
const dbFor=uid=>env.authenticatedContext(uid).firestore();
function batch(uid){const db=dbFor(uid),b=writeBatch(db);b.update(doc(db,'tournaments/'+code),{data:JSON.stringify({...state,marker:uid}),updatedAt:2});b.update(doc(db,'publicTournaments/'+code),{bracketView:JSON.stringify({...state,marker:uid}),updatedAt:2});return b.commit();}
test('full composed rules block seated, unseated and ordinary player direct score writes',async()=>{for(const uid of ['seated','unseated','player'])await assertFails(batch(uid));});
test('full composed rules preserve host and administrator management writes',async()=>{for(const uid of ['host','admin'])await assertSucceeds(batch(uid));});
test('full composed rules protect canonical seats and assignment projection from managers',async()=>{for(const uid of ['host','admin']){const db=dbFor(uid);await assertFails(updateDoc(doc(db,'tournaments/'+code),{refereeSeatsV1:{version:1,revision:999}}));await assertFails(updateDoc(doc(db,'tournaments/'+code),{refereeStationAssignments:{1:['intruder']}}));}});
test('full composed rules keep receipts and audits inaccessible to all client roles',async()=>{for(const uid of ['seated','host','admin'])for(const collection of ['refereeSeatOperations','refereeScoreOperations','refereeSeatAudit','refereeScoreAudit']){const ref=doc(dbFor(uid),'tournaments/'+code+'/'+collection+'/forged');await assertFails(setDoc(ref,{uid}));await assertFails(getDoc(ref));}});

test('community private reads follow current seats; player referees cannot forge seats or submit JSON',async()=>{
 const roomCode='BXH-COMMUNITY',state={id:'community-rules',meta:{eventAuthority:'community',ladderMode:'general',stations:1},players:[],matches:[]};
 const expiry=Timestamp.fromMillis(Date.now()+86400000);
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'systemConfig/refereeSeatsV1'),{enabled:true,perCourtScoringVerified:true,communitySeatsEnabled:true});
  for(const uid of ['community-host','community-main','community-backup','community-outsider','community-frozen'])
   await setDoc(doc(db,'users/'+uid),{active:true,role:'player',isTestAccount:false,...(uid==='community-frozen'?{accountStatus:'frozen'}:{})});
  await setDoc(doc(db,'tournaments/'+roomCode),{...common,eventAuthority:'community',createdBy:'community-host',ownerUid:'community-host',createdByRole:'player',ladderPointsAwarded:false,data:JSON.stringify(state),refereeSeatsV1:{version:1,courts:{1:{revision:1,main:{uid:'community-main'},backup1:{uid:'community-backup'},backup2:{uid:'community-frozen'}}}},refereeStationUids:['community-main','community-backup','community-frozen']});
  await setDoc(doc(db,'publicTournaments/'+roomCode),{...common,eventAuthority:'community',createdBy:'community-host',ownerUid:'community-host',createdByRole:'player',expiresAt:expiry,bracketView:JSON.stringify(state)});
 });
 for(const uid of ['community-main','community-backup']){
  const room=doc(dbFor(uid),'tournaments/'+roomCode);await assertSucceeds(getDoc(room));
  await assertFails(updateDoc(room,{data:JSON.stringify({...state,forged:true})}));
  await assertFails(updateDoc(room,{refereeStationUids:[uid]}));
 }
 for(const uid of ['community-outsider','community-frozen'])await assertFails(getDoc(doc(dbFor(uid),'tournaments/'+roomCode)));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'tournaments/'+roomCode)));
 await assertFails(getDocs(collection(dbFor('community-main'),'tournaments')));
 // Positive owner management is a release-baseline regression: the generic
 // October candidate predates the deployed role-helper budget fixes and is
 // never the deployment artifact. Its read/ownership guards are still tested.
 const owner=dbFor('community-host');
 if(process.env.REFEREE_RULES_PATH){
  const ownerBatch=writeBatch(owner);
  ownerBatch.update(doc(owner,'tournaments/'+roomCode),{data:JSON.stringify({...state,ownerManaged:true}),updatedAt:2});
  ownerBatch.update(doc(owner,'publicTournaments/'+roomCode),{bracketView:JSON.stringify({...state,ownerManaged:true}),updatedAt:2});
  await assertSucceeds(ownerBatch.commit());
 }
 await assertFails(updateDoc(doc(owner,'tournaments/'+roomCode),{refereeSeatsV1:{version:1,courts:{}}}));
 for(const uid of ['community-host','community-main'])await assertFails(setDoc(doc(dbFor(uid),'users/community-main/communityRefereeInbox/forged'),{refereeInviteStatus:'accepted'}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'tournaments/'+roomCode),{refereeStationUids:['community-backup']}));
 await assertFails(getDoc(doc(dbFor('community-main'),'tournaments/'+roomCode)));
 await assertSucceeds(getDoc(doc(dbFor('community-backup'),'tournaments/'+roomCode)));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'systemConfig/refereeSeatsV1'),{communitySeatsEnabled:false}));
 await assertFails(getDoc(doc(dbFor('community-backup'),'tournaments/'+roomCode)));
});
