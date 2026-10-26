const {buildRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
const makeSnapshot=(eventCode,drawRevision,rosterUids)=>buildRosterSnapshot({eventCode,drawRevision,rosterUids,capturedAt:150,verifiedTiers:rosterUids.map(uid=>({ok:true,uid,tier:'d',computedAt:100,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)}))});
'use strict';
// P3-46: real Firestore Emulator verification of the isolated synchronized
// private/public start reference. Not a production start service.
// Requires a demo project and Firestore Emulator; never touches live rooms.
const test=require('node:test'),assert=require('node:assert/strict');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore Emulator is required');
const project=process.env.GCLOUD_PROJECT||'demo-bxh-arena-e2e';
if(project!=='demo-bxh-arena-e2e')throw Error('RDW tests require the demo project');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();
const {writeSynchronizedStart}=require('../scripts/lib/rdw-synchronized-start-reference.cjs');
const prefix='p346-'+Date.now()+'-'+process.pid;
const code='BXH-STRT46';
function refs(label){return {
 eventRef:db.collection('rdwMirrorEmulatorTests').doc(prefix+'-'+label+'-private'),
 publicRef:db.collection('rdwMirrorEmulatorTests').doc(prefix+'-'+label+'-public'),
 snapshotRef:db.collection('rdwMirrorEmulatorTests').doc(prefix+'-'+label+'-sealed')
};}
async function createFixture(label,{general=false,stale=false,missingSnapshot=false,createSnapshot=false}={}){
 const r=refs(label);
 const players=[{id:'p1',uid:'uid_a'},{id:'p2',uid:'uid_b'}];
 const matches=[{id:'match1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}];
 const privateState={cloudCode:code,registrationRosterRevision:4,meta:{ladderMode:general?'general':'ranked',eventAuthority:'official'},drawnAt:100,players,matches,startedAt:null,rosterLocked:false};
 const publicView={cloudCode:code,registrationRosterRevision:stale?5:4,drawnAt:100,players:players.map(p=>({id:p.id,name:p.id})),matches,startedAt:null};
 await Promise.all([
  r.eventRef.create({code,data:JSON.stringify(privateState),visibility:'public'}),
  r.publicRef.create({bracketView:JSON.stringify(publicView),visibility:'public'}),
  ...(missingSnapshot||createSnapshot?[]:[r.snapshotRef.create(makeSnapshot(code,7,['uid_a','uid_b']))])
 ]);
 const args={...r,eventCode:code,expectedRosterRevision:4,drawRevision:7,serverTime:200,authorized:true,bracketVerified:true,...(createSnapshot?{snapshotCandidate:makeSnapshot(code,7,['uid_a','uid_b'])}:{})};
 return {r,args,run:override=>db.runTransaction(tx=>writeSynchronizedStart({...args,...override,tx}))};
}
test('Emulator commits private JSON and public bracketView in one transaction',async()=>{
 const f=await createFixture('success'),out=await f.run();
 assert.equal(out.committed,true);
 const [p,q]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get()]);
 assert.equal(JSON.parse(p.data().data).startedAt,200);
 assert.equal(JSON.parse(q.data().bracketView).startedAt,200);
 assert.equal(JSON.parse(p.data().data).rosterLocked,true);
 assert.equal(JSON.parse(p.data().data).rdwSnapshotDigest,makeSnapshot(code,7,['uid_a','uid_b']).snapshotDigest);
 assert.equal(p.data().rdwSnapshotDigest,makeSnapshot(code,7,['uid_a','uid_b']).snapshotDigest);
 assert.equal(p.data().visibility,'public');assert.equal(q.data().visibility,'public');
});
test('Emulator rollback leaves both mirrors untouched after injected transaction failure',async()=>{
 const f=await createFixture('rollback');
 await assert.rejects(db.runTransaction(async tx=>{
  await writeSynchronizedStart({...f.args,tx});throw Error('simulated-before-commit-failure');
 }),/simulated-before-commit-failure/);
 const [p,q]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get()]);
 assert.equal(JSON.parse(p.data().data).startedAt,null);
 assert.equal(JSON.parse(q.data().bracketView).startedAt,null);
});
test('Emulator rejects general events, stale mirror and absent snapshot without writes',async()=>{
 for(const [label,opts] of [['general',{general:true}],['stale',{stale:true}],['missing',{missingSnapshot:true}]]){
  const f=await createFixture(label,opts),out=await f.run();
  assert.equal(out.committed,false);
  const [p,q]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get()]);
  assert.equal(JSON.parse(p.data().data).startedAt,null);
  assert.equal(JSON.parse(q.data().bracketView).startedAt,null);
 }
});
test('Emulator concurrent starts cannot both commit',async()=>{
 const f=await createFixture('concurrent');
 const results=await Promise.allSettled([f.run(),f.run()]);
 assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.committed).length,1);
 const [p,q]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get()]);
 assert.equal(JSON.parse(p.data().data).startedAt,200);
 assert.equal(JSON.parse(q.data().bracketView).startedAt,200);
 assert.equal((await f.run()).committed,false);
});

test('Emulator atomically creates sealed snapshot and both mirrors',async()=>{
 const f=await createFixture('candidate',{createSnapshot:true});
 const result=await f.run();assert.equal(result.committed,true);
 const [e,p,snap]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get(),f.r.snapshotRef.get()]);
 assert.equal(snap.exists,true);
 assert.equal(JSON.parse(e.data().data).rdwSnapshotDigest,snap.data().snapshotDigest);
 assert.equal(JSON.parse(e.data().data).startedAt,200);
 assert.equal(JSON.parse(p.data().bracketView).startedAt,200);
});
test('Emulator rolls back new snapshot creation with both mirror updates on crash',async()=>{
 const f=await createFixture('candidate-rollback',{createSnapshot:true});
 await assert.rejects(db.runTransaction(async tx=>{
  await writeSynchronizedStart({...f.args,tx});throw Error('simulated-after-staged-write');
 }),/simulated-after-staged-write/);
 const [e,p,snap]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get(),f.r.snapshotRef.get()]);
 assert.equal(snap.exists,false);
 assert.equal(JSON.parse(e.data().data).startedAt,null);
 assert.equal(JSON.parse(p.data().bracketView).startedAt,null);
});
