'use strict';
const assert=require('node:assert/strict'),{createRequire}=require('node:module');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:18886')throw Error('loopback-emulator-required');
const requireAdmin=createRequire(require('node:path').resolve(__dirname,'../function-tools/package.json'));
const {initializeApp,deleteApp}=requireAdmin('firebase-admin/app'),{getFirestore}=requireAdmin('firebase-admin/firestore');
const {fixture}=require('../engine-fixture.cjs'),{createPublisher}=require('./publisher.cjs'),{createScoringWithOutbox}=require('./scoring-adapter.cjs'),{dispatchOnce}=require('./dispatcher.cjs'),schema=require('../public-schema.cjs');
(async()=>{
 const app=initializeApp({projectId:'demo-bxh-arena-e2e'}),db=getFirestore(app),room='BXH-DEMOWORKER',f=fixture(),config={mode:'offline-test',projectId:'demo-bxh-arena-e2e',room,epoch:'demo-worker-v2'};
 for(const s of Object.values(f.room.refereeSeatsV1.courts))s.main.name='Synthetic Referee';
 const ref=db.doc('tournaments/'+room);await ref.set({...f.room,data:JSON.stringify(f.state),visibility:'public'});
 await db.doc('publicTournaments/'+room).set({bracketView:JSON.stringify(f.projection())});await db.doc('users/demo-ref').set(f.user);await db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true});
 let fail=true;const publisher=createPublisher(db,config,{validate:v=>{if(fail)throw Error('injected-schema-failure');return schema.validate(v);}}),score=createScoringWithOutbox(db,publisher,{clock:()=>5000});let seq=0;
 async function request(index=0){const state=JSON.parse((await ref.get()).data().data),id=f.current()[index].id,m=state.matches.find(m=>m.id===id);return {auth:{uid:'demo-ref'},data:{...f.request('score',id,{side:'A',points:1,finish:'spin'}),code:room,operationId:'demo-worker-operation-'+(++seq),expectedScoreRevision:m.refereeSeatScoreRevision||0}};}
 const first=await request();await score(first);assert.equal(JSON.parse((await ref.get()).data().data).matches.find(m=>m.id===first.data.matchId).scoreA,1);
 await assert.rejects(dispatchOnce(db,publisher,room),/injected/);assert(!(await db.doc('stagingScorePublisher/'+room).get()).exists);
 const marker=(await db.collection('stagingScoreOutbox/'+room+'/events').get()).docs[0].data();assert.deepEqual(Object.keys(marker).sort(),['epoch','revision','schema']);
 // Legacy full public path still committed while new publisher is unavailable.
 assert.equal(JSON.parse((await db.doc('publicTournaments/'+room).get()).data().bracketView).matches.find(m=>m.id===first.data.matchId).scoreA,1);
 fail=false;assert.equal((await dispatchOnce(db,publisher,room)).revision,1);await score(first);assert.equal((await ref.get()).data().stagingPublicationRevision,1);assert((await dispatchOnce(db,publisher,room)).duplicate);
 // Different courts race on same room; real Firestore transaction retry must preserve both.
 const requests=await Promise.all([request(1),request(2)]);await Promise.all(requests.map(score));const saved=(await ref.get()).data();assert.equal(saved.stagingPublicationRevision,3);for(const r of requests)assert.equal(JSON.parse(saved.data).matches.find(m=>m.id===r.data.matchId).scoreA,1);
 assert.equal((await dispatchOnce(db,publisher,room)).type,'checkpoint');assert.equal((await publisher.publish(2)).duplicate,true);
 const before=JSON.stringify((await ref.get()).data());await dispatchOnce(db,publisher,room);assert.equal(JSON.stringify((await ref.get()).data()),before);
 await ref.update({stagingPublicationDisabled:true});const disabled=await request(3);await score(disabled);assert.equal((await ref.get()).data().stagingPublicationRevision,3);await assert.rejects(dispatchOnce(db,publisher,room),/eligible/);
 await ref.update({stagingPublicationDisabled:false,visibility:'private'});const hidden=await request(4);await score(hidden);assert.equal((await ref.get()).data().stagingPublicationRevision,3);await assert.rejects(dispatchOnce(db,publisher,room),/eligible/);
 console.log(JSON.stringify({passed:true,realFirestoreEmulator:true,actualScoringHandler:true,actualCallable:false,fullBrowser:false,failedPublisherScoreCommitted:true,legacyPreserved:true,recovery:true,duplicate:true,concurrentCourts:2,minimalMarker:true,disabledAndInvisibleNewPublicationDenied:true}));await deleteApp(app);
})().catch(e=>{console.error(e);process.exitCode=1;});
