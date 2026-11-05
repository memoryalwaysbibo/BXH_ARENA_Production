'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8091')throw Error('Dedicated local demo emulator required');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
initializeApp({projectId:'demo-qr-checkin'});
const db=getFirestore(),{createSync}=require('./functions/service.cjs');
const sync=createSync(db);
let serial=0;
async function seed(n=60){
 const code='BXH-PUB'+String(++serial).padStart(4,'0'),ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const players=Array.from({length:53},(_,i)=>({id:'online_r'+i,name:'公開玩家'+i,source:'online',registrationId:'r'+i,registrationUid:'u'+i,checkedIn:i===0}));
 const common={visibility:'public',registrationVisibility:'public',registrationEnabled:true,tournamentPhase:'waiting',confirmedCount:n,waitlistCount:0,updatedAt:123};
 const batch=db.batch();batch.set(ref,{...common,data:JSON.stringify({meta:{checkinRequired:true},players,matches:[]})});
 batch.set(pub,{...common,bracketView:JSON.stringify({players:players.map(({id,name,checkedIn})=>({id,name,checkedIn}))})});
 for(let i=0;i<n;i++)batch.set(ref.collection('registrations').doc('r'+i),{uid:'u'+i,status:'confirmed',displayName:'公開玩家'+i,phone:'private',email:'private'});
 batch.set(db.doc('systemConfig/publicRegistrationRosterSync'),{enabled:true});
 await batch.commit();return {code,ref,pub};
}
test('real transactions: 100 overlapping duplicate events converge to one public roster without changing the private room',async()=>{
 const x=await seed(),before=(await x.ref.get()).data();
 // Source CAS can legitimately reject overlapping workers. The retry below models
 // Eventarc redelivery; the entrypoint is limited to one active request per service.
 await Promise.allSettled(Array.from({length:100},()=>sync(x.code)));
 await sync(x.code);
 const out=(await x.pub.get()).data().publicRegistrationRoster;
 assert.equal(out.players.length,60);assert.equal(out.players[0].checkedIn,true);
 assert(!JSON.stringify(out).includes('private'));assert.deepEqual((await x.ref.get()).data(),before);
 const stamp=(await x.pub.get()).updateTime;await sync(x.code);
 assert(stamp.isEqual((await x.pub.get()).updateTime));
});
test('real registrations: cancellation and replacement at the same count replace the displayed name',async()=>{
 const x=await seed();await sync(x.code);
 const b=db.batch();b.update(x.ref.collection('registrations').doc('r0'),{status:'cancelled'});
 b.set(x.ref.collection('registrations').doc('replacement'),{uid:'new',displayName:'遞補新玩家',status:'confirmed'});
 b.update(x.ref,{updatedAt:124});b.update(x.pub,{updatedAt:124});await b.commit();await sync(x.code);
 const out=(await x.pub.get()).data().publicRegistrationRoster;
 assert.equal(out.players.length,60);assert(!out.players.some(p=>p.id==='online_r0'));assert(out.players.some(p=>p.name==='遞補新玩家'));
});
test('real transactions: an inconsistent counter and a started room cannot publish a new overlay',async()=>{
 const x=await seed();await x.pub.update({confirmedCount:61});
 await assert.rejects(sync(x.code),/count-conflict/);assert.equal((await x.pub.get()).data().publicRegistrationRoster,undefined);
 await x.ref.update({tournamentPhase:'live'});await sync(x.code);assert.equal((await x.pub.get()).data().publicRegistrationRoster,undefined);
});
