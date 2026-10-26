'use strict';
const {test,before,after}=require('node:test'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,writeBatch}=require('firebase/firestore');
let env;
const code='BXH-FULLSEATS',common={eventAuthority:'official',createdBy:'host',ownerUid:'host',createdByRole:'staff',assignedStaffUids:['host','seated','unseated'],visibility:'public',ladderMode:'general',tournamentPhase:'waiting',archiveStatus:'ongoing',registrationEnabled:false,registrationStatus:'closed',confirmedCount:0,waitlistCount:0,updatedAt:1};
const state={id:'full-rule-fixture',meta:{name:'Full seat rules fixture',eventAuthority:'official',stations:1},players:[],matches:[]};
before(async()=>{
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8197')throw Error('dedicated local emulator required');
 env=await initializeTestEnvironment({projectId:'demo-referee-seat-full-rules',firestore:{host:'127.0.0.1',port:8197,rules:fs.readFileSync(__dirname+'/firestore.candidate.rules','utf8')}});
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
