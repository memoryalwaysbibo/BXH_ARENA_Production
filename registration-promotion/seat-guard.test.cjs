'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,writeBatch,serverTimestamp}=require('firebase/firestore');
let env,serial=0;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-seated-staff',firestore:{host:'127.0.0.1',port:8091,rules:fs.readFileSync(__dirname+'/fixtures/firestore.reviewed.rules','utf8')}});});
after(async()=>{await env?.cleanup();});
for(const seats of [false,true])for(const creator of [false,true])test(`80/1 capacity 88 staff seats=${seats} creator=${creator}`,async()=>{
 const code='BXH-CASE'+(++serial),db=env.authenticatedContext('staff').firestore();
 const players=Array.from({length:80},(_,i)=>({id:'p'+i,name:'Synthetic '+i}));
 const candidate={id:'candidate',name:'Synthetic candidate',registrationId:'candidate',source:'online'};
 const state={meta:{registrationCapacity:88},players,waitlistPlayers:[candidate]};
 const common={eventAuthority:'official',createdBy:creator?'staff':'host',ownerUid:'host',createdByRole:'staff',assignedStaffUids:['staff'],visibility:'public',ladderMode:'general',tournamentPhase:'waiting',archiveStatus:'ongoing',registrationEnabled:true,registrationStatus:'open',capacity:88,confirmedCount:80,waitlistCount:1,updatedAt:1,...(seats?{refereeSeatsV1:{version:1,revision:1,courts:{},requests:{}},refereeSeatNames:{}}:{})};
 await env.withSecurityRulesDisabled(async c=>{
  const d=c.firestore();await setDoc(doc(d,'users/staff'),{role:'staff',active:true});
  await setDoc(doc(d,'tournaments/'+code),{...common,data:JSON.stringify(state)});
  await setDoc(doc(d,'publicTournaments/'+code),{...common,bracketView:JSON.stringify(state)});
  await setDoc(doc(d,'tournaments/'+code+'/registrations/candidate'),{uid:'candidate',status:'waitlist',displayName:'Synthetic candidate'});
 });
 const next={...state,players:[...players,candidate],waitlistPlayers:[],registrationRosterRevision:1};
 const patch={confirmedCount:81,waitlistCount:0,capacity:88,registrationStatus:'open',updatedAt:2,lastRegistrationMutationUid:'candidate',lastRegistrationMutationType:'promote',lastRegistrationMutationBy:'staff'};
 const b=writeBatch(db);
 b.update(doc(db,'tournaments/'+code+'/registrations/candidate'),{status:'confirmed',promotedAt:serverTimestamp(),promotedBy:'staff',updatedAt:serverTimestamp()});
 b.update(doc(db,'tournaments/'+code),{...patch,data:JSON.stringify(next)});
 b.update(doc(db,'publicTournaments/'+code),{...patch,bracketView:JSON.stringify(next)});
 let error;try{await b.commit();}catch(e){error=e;}
 console.log(JSON.stringify({seats,creator,allowed:!error,error:error?.message}));
 assert.equal(!error,!seats||creator);
});
