'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const project='demo-bxh-bucket-posters';assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,FieldValue}=require('firebase-admin/firestore');
const {fixture,storage,load,request,assigned,code,oldPoster,oldCover}=require('./probe.cjs');
const app=initializeApp({projectId:project}),db=getFirestore(app);db.settings({host:'127.0.0.1:8188',ssl:false});
const collections=['tournaments','publicTournaments','users','eventStaffAssignments'];
async function seed(f){for(const c of collections)await db.recursiveDelete(db.collection(c));const b=db.batch();for(const [p,v]of f.m.rows)b.set(db.doc(p),v);await b.commit();}
async function all(){const result=[];for(const c of collections){const q=await db.collection(c).get();for(const s of q.docs)result.push([s.ref.path,s.data()]);}return JSON.stringify(result.sort(([a],[b])=>a.localeCompare(b)));}
const run=(s,action,{candidate=true,uid='owner',project='bxh-arena',uuid=null}={})=>load(candidate,{m:{db}},s,{project,uuid})._test.handleRoomPosterCover(request(action,uid),{db,bucket:s.bucket});
(async()=>{let checks=0;
 try{
  for(const action of ['saveCover','savePoster']){
   let golden;
   for(const candidate of [false,true]){const f=fixture(),s=storage();await seed(f);const result=await run(s,action,{candidate});const value={result,db:await all(),storage:s.calls,deleted:s.deletes};if(!candidate)golden=value;else assert.deepEqual(value,golden);}checks++;
   const f=fixture(true),s=storage();await seed(f);const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),before=(await root.get()).data();assert((await run(s,action)).ok);const after=(await root.get()).data();assert.equal(after.data,before.data);assert.deepEqual(after.scoreStorage,before.scoreStorage);assert.deepEqual((await pub.get()).data().scoreBucketProjection,f.pub.scoreBucketProjection);checks++;
  }
  for(const action of ['saveCover','savePoster'])for(const side of ['tournaments','publicTournaments'])for(const key of ['bucketMigration','deletionStatus'])for(const value of [null,false]){
   await seed(fixture());await db.doc(side+'/'+code).update({[key]:value});const before=await all(),s=storage();await assert.rejects(()=>run(s,action));assert.equal(s.calls.length,0);assert.equal(await all(),before);checks++;
  }
  for(const action of ['saveCover','savePoster'])for(const change of ['private-reuse','public-reuse','actor-disabled','owner','epoch','mode','migration','deleted']){
   await seed(fixture(true));let expected;
   const s=storage({afterSave:async(_,n)=>{if(n!==1)return;const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
    if(change==='private-reuse'){const data=(await root.get()).data();await root.delete();await root.set(data);}
    if(change==='public-reuse'){const data=(await pub.get()).data();await pub.delete();await pub.set(data);}
    if(change==='actor-disabled')await db.doc('users/owner').update({active:false});
    if(change==='owner')await root.update({createdBy:'other'});
    if(change==='epoch'){await root.update({'scoreStorage.epoch':'new'});await pub.update({'scoreBucketProjection.epoch':'new'});}
    if(change==='mode'){await root.update({scoreStorage:FieldValue.delete()});await pub.update({scoreBucketProjection:FieldValue.delete()});}
    if(change==='migration')await pub.update({bucketMigration:null});
    if(change==='deleted')await root.delete();expected=await all();
   }});
   await assert.rejects(()=>run(s,action));assert.equal(await all(),expected);assert.equal(s.rows.size,2);assert(s.rows.has(oldPoster)&&s.rows.has(oldCover));checks++;
  }
  for(const action of ['saveCover','savePoster'])for(const type of ['lost-ack','unknown','abort']){
   await seed(fixture(true));const s=storage(),native=db.runTransaction.bind(db);let calls=0;
   db.runTransaction=async cb=>{calls++;if(calls===1){if(type==='abort')return native(async tx=>{await cb(tx);throw Error('forced abort');});await native(cb);throw Error('commit response lost');}if(type==='unknown')throw Error('read unavailable');return native(cb);};
   try{if(type==='lost-ack')assert((await run(s,action)).ok);else await assert.rejects(()=>run(s,action));}finally{db.runTransaction=native;}
   const top=(await db.doc('tournaments/'+code).get()).data();assert(s.rows.has(top.coverPath));if(type==='abort')assert.equal(top.coverPath,oldCover);checks++;
  }
  for(const action of ['saveCover','savePoster'])for(const failAt of action==='savePoster'?[1,2]:[1]){await seed(fixture());const before=await all(),s=storage({failAt});await assert.rejects(()=>run(s,action));assert.equal(await all(),before);assert.equal(s.rows.size,2);checks++;}
  // Captured accepted staff grant works; an old grant cannot attach to a reused root.
  for(const stale of [false,true]){
   const f=assigned();await seed(f);
   if(stale){const root=db.doc('tournaments/'+code),data=(await root.get()).data();await root.delete();await root.set(data);}
   const s=storage();if(stale){await assert.rejects(()=>run(s,'savePoster',{uid:f.uid}));assert.equal(s.calls.length,0);}else assert((await run(s,'savePoster',{uid:f.uid})).ok);checks++;
  }
  for(const why of ['grant-revoked','parent-expired']){
   const f=assigned();await seed(f);let expected;const s=storage({afterSave:async(_,n)=>{if(n!==1)return;if(why==='grant-revoked')await db.doc(f.assignmentRef).update({status:'revoked'});else await db.doc('users/organizer').update({'partnerOrganizer.expiresAtMs':1});expected=await all();}});
   await assert.rejects(()=>run(s,'savePoster',{uid:f.uid}));assert.equal(await all(),expected);assert.equal(s.rows.size,2);checks++;
  }
  {const f=assigned();await seed(f);const root=db.doc('tournaments/'+code),snap=await root.get(),t=snap.createTime,birth=t.seconds+':'+t.nanoseconds;await db.doc(f.assignmentRef).update({sourceCreatedAt:birth});await root.update({['eventStaffAssignments.'+f.uid+'.sourceCreatedAt']:birth});assert((await run(storage(),'savePoster',{uid:f.uid})).ok);checks++;}
  {await seed(fixture());const s=storage(),before=await all();await assert.rejects(()=>run(s,'savePoster',{project:'demo-bxh-bucket-posters'}));assert.equal(await all(),before);assert.equal(s.calls.length,0);checks++;}
  for(const action of ['saveCover','savePoster']){
   await seed(fixture(true));const s=storage();const results=await Promise.all([run(s,action,{uuid:crypto.randomUUID}),run(s,action,{uuid:crypto.randomUUID})]);assert(results.every(r=>r.ok));
   const top=(await db.doc('tournaments/'+code).get()).data(),pub=(await db.doc('publicTournaments/'+code).get()).data();assert(s.rows.has(top.coverPath));if(action==='savePoster')assert(s.rows.has(top.posterPath));assert.equal(pub.coverUrl,top.coverUrl);checks++;
  }
  console.log(JSON.stringify({nativePosterChecks:checks,project,productionRequests:0,productionWrites:0,scope:'real Firestore SDK transactions; mocked Storage, synthetic auth and injected business project/clock; no real GCS/Auth/Eventarc'}));
 }finally{await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1;});
