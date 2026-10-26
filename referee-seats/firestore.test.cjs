'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {createHandler}=require('./functions/service.cjs');
let app,db,handle,seq=0;
const code='BXH-SEATTEST',ref=()=>db.doc('tournaments/'+code);
const request=(uid,action,args={})=>({auth:{uid},data:{code,operationId:'emulator-operation-'+(++seq),action,...args}});
before(async()=>{
 assert(process.env.FIRESTORE_EMULATOR_HOST,'emulator required; never run against Production');
 app=initializeApp({projectId:'demo-referee-seat-service'},'seats');db=getFirestore(app);handle=createHandler(db);
 const state={id:'seat-room',meta:{eventAuthority:'official',stations:1},matches:[{id:'m',scoreA:2,scoreB:1,faultActions:[{offender:'A'}]}]};
 await Promise.all([
 ref().set({createdBy:'host',eventAuthority:'official',assignedStaffUids:['a','b','c'],refereeStationAssignments:{},data:JSON.stringify(state),updatedAt:1}),
 db.doc('publicTournaments/'+code).set({bracketView:JSON.stringify({meta:{},matches:state.matches})}),
 db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true}),
 ...['host','a','b','c'].map(uid=>db.doc('users/'+uid).set({active:true,role:'staff',realName:uid}))]);
 await handle(request('host','enable'));
});
after(async()=>{await deleteApp(app);});
test('real Firestore retries produce one claim and atomic swap with immutable match data',async()=>{
 const results=await Promise.allSettled(['a','b'].map(uid=>handle(request(uid,'claim',{station:1,slot:'main',expectedCourtRevision:0}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 let room=(await ref().get()).data(),holder=room.refereeSeatsV1.courts['1'].main.uid,backup=holder==='a'?'b':'a';
 await handle(request(backup,'claim',{station:1,slot:'backup1',expectedCourtRevision:1}));
 const r=await handle(request(backup,'request',{station:1,slot:'main',expectedCourtRevision:2,expectedUid:holder}));
 const accept=request(holder,'respond',{station:1,slot:'main',requestId:r.requestId,response:'accept'});
 const first=await handle(accept),retry=await handle(accept);assert.deepEqual(first,retry);
 room=(await ref().get()).data();assert.equal(room.refereeSeatsV1.courts['1'].main.uid,backup);assert.equal(room.refereeSeatsV1.courts['1'].backup1.uid,holder);
 const state=JSON.parse(room.data);assert.equal(state.matches[0].scoreA,2);assert.equal(state.matches[0].faultActions.length,1);
 const mirror=JSON.parse((await db.doc('publicTournaments/'+code).get()).data().bracketView);assert.equal(mirror.meta.refereeSeatNames['1'].main.name,backup);assert(!JSON.stringify(mirror).includes('"uid"'));
 const audits=await ref().collection('refereeSeatAudit').get();assert.equal(audits.size,5);
});
