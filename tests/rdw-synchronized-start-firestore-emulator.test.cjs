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
const code='BXH-START46';
function refs(label){return {
 eventRef:db.collection('rdwMirrorEmulatorTests').doc(prefix+'-'+label+'-private'),
 publicRef:db.collection('rdwMirrorEmulatorTests').doc(prefix+'-'+label+'-public'),
 snapshotRef:db.collection('rdwMirrorEmulatorTests').doc(prefix+'-'+label+'-sealed')
};}
async function createFixture(label,{general=false,stale=false,missingSnapshot=false}={}){
 const r=refs(label);
 const players=[{id:'p1',uid:'uid_a'},{id:'p2',uid:'uid_b'}];
 const matches=[{id:'match1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}];
 const privateState={cloudCode:code,registrationRosterRevision:4,meta:{ladderMode:general?'general':'ranked',eventAuthority:'official'},drawnAt:100,players,matches,startedAt:null,rosterLocked:false};
 const publicView={cloudCode:code,registrationRosterRevision:stale?5:4,drawnAt:100,players:players.map(p=>({id:p.id,name:p.id})),matches,startedAt:null};
 await Promise.all([
  r.eventRef.create({code,data:JSON.stringify(privateState),visibility:'public'}),
  r.publicRef.create({bracketView:JSON.stringify(publicView),visibility:'public'}),
  ...(missingSnapshot?[]:[r.snapshotRef.create({source:'server',verified:true,sealed:true,eventCode:code,drawRevision:7,snapshotDigest:'a'.repeat(64)})])
 ]);
 const args={...r,eventCode:code,expectedRosterRevision:4,drawRevision:7,serverTime:200,authorized:true,bracketVerified:true};
 return {r,args,run:override=>db.runTransaction(tx=>writeSynchronizedStart({...args,...override,tx}))};
}
test('Emulator commits private JSON and public bracketView in one transaction',async()=>{
 const f=await createFixture('success'),out=await f.run();
 assert.equal(out.committed,true);
 const [p,q]=await Promise.all([f.r.eventRef.get(),f.r.publicRef.get()]);
 assert.equal(JSON.parse(p.data().data).startedAt,200);
 assert.equal(JSON.parse(q.data().bracketView).startedAt,200);
 assert.equal(JSON.parse(p.data().data).rosterLocked,true);
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
