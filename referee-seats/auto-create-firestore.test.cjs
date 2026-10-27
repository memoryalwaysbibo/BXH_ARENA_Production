'use strict';
// Real Firestore emulator test for the trusted room-create candidate.
// This file MUST fail closed when the emulator is absent.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {createHandler}=require('./auto-create-service.cjs');
let app,db,create;
let seq=0;
function request(code='BXH-NEWSEAT',op='new-room-emulator-op-001',uid='owner',override={}){
 const state={id:'new',cloudCode:code,createdBy:uid,meta:{eventAuthority:'official',battleMode:'individual',playMode:'standard',stations:3,assignedStaffUids:[]},players:[],matches:[],teams:[],bracketSize:0};
 return {auth:{uid},data:{code,operationId:op,
  privatePayload:{data:JSON.stringify(state),createdBy:uid,eventAuthority:'official',battleMode:'individual',playMode:'standard',confirmedCount:0,waitlistCount:0},
  publicPayload:{bracketView:JSON.stringify({meta:{eventAuthority:'official',battleMode:'individual',stations:3}}),eventAuthority:'official',battleMode:'individual'},
  ...override}};
}
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('FIRESTORE_EMULATOR_HOST required; refusing production');
 app=initializeApp({projectId:'demo-auto-seat-create'},'auto-create');
 db=getFirestore(app);
 await Promise.all([
  db.doc('users/owner').set({active:true,isTestAccount:false,role:'staff',realName:'Owner'}),
  db.doc('users/other').set({active:true,isTestAccount:false,role:'staff',realName:'Other'}),
  db.doc('users/player').set({active:true,isTestAccount:false,role:'player',realName:'Player'}),
  db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true})
 ]);
 create=createHandler(db,{clock:()=>1000});
});
after(async()=>{if(app)await deleteApp(app);});
test('real Firestore transaction atomically creates three empty seats and matching public mirror',async()=>{
 const code='BXH-NEWSEAT';
 const out=await create(request(code));
 assert.deepEqual(out,{ok:true,code,idempotent:false});
 const [a,b]=await Promise.all([db.doc('tournaments/'+code).get(),db.doc('publicTournaments/'+code).get()]);
 assert(a.exists&&b.exists);
 const privateRoom=a.data(),state=JSON.parse(privateRoom.data),publicMirror=JSON.parse(b.data().bracketView);
 assert.equal(privateRoom.refereeSeatsV1.version,1);
 assert.deepEqual(Object.keys(privateRoom.refereeSeatsV1.courts),['1','2','3']);
 assert.equal(state.meta.refereeSeatsV1.version,1);
 assert.deepEqual(privateRoom.assignedStaffUids,['owner']);
 assert.equal(publicMirror.meta.refereeSeatNames['2'].backup1,null);
 assert(!JSON.stringify(publicMirror).includes('"uid"'));
 assert(!JSON.stringify(publicMirror).includes('"refereeSeatsV1"'));
});
test('same operation id retries without touching the original documents',async()=>{
 const code='BXH-NEWSEAT',beforeRoom=(await db.doc('tournaments/'+code).get()).data();
 assert.deepEqual(await create(request(code)),{ok:true,code,idempotent:true});
 assert.deepEqual((await db.doc('tournaments/'+code).get()).data(),beforeRoom);
 await assert.rejects(create(request(code,'new-room-emulator-op-002')),/room-code-conflict/);
});
test('unauthorized and invalid requests leave neither document behind',async()=>{
 const code='BXH-NOACCESS';
 await assert.rejects(create(request(code,'new-room-emulator-op-003','player')),/permission-denied/);
 await assert.rejects(create(request(code,'new-room-emulator-op-004','owner',{
  publicPayload:{bracketView:JSON.stringify({meta:{eventAuthority:'official',battleMode:'individual',stations:3},private:{uid:'leak'}}),eventAuthority:'official',battleMode:'individual'}
 })),/private-mirror-data/);
 const [a,b]=await Promise.all([db.doc('tournaments/'+code).get(),db.doc('publicTournaments/'+code).get()]);
 assert.equal(a.exists,false);assert.equal(b.exists,false);
});
test('concurrent creation of same code commits only once',async()=>{
 const code='BXH-RACENEW';
 const results=await Promise.allSettled([
  create(request(code,'new-room-emulator-op-005','owner')),
  create(request(code,'new-room-emulator-op-006','other'))
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const [a,b]=await Promise.all([db.doc('tournaments/'+code).get(),db.doc('publicTournaments/'+code).get()]);
 assert(a.exists&&b.exists);
 assert.equal(a.data().createdBy,results[0].status==='fulfilled'?'owner':'other');
});
