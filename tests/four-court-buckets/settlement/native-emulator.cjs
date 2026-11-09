'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const project='demo-bxh-four-court-buckets';
assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,FieldValue}=require('firebase-admin/firestore');
const {fixture,largeFixture,specs,NOW,code}=require('./probe.cjs');
const app=initializeApp({projectId:project}),db=getFirestore(app);db.settings({host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
const release=path.resolve(__dirname,'../../../release/buckets/settlement'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'bucket-settlement-native-')),cache=new Map();
const collections=['users','tournaments','publicTournaments','systemConfig','ladderPlayers','ladderTransactions','ladderSystem'];
function handler(spec,candidate,{production=false}={}){const key=spec.function+candidate+production;if(cache.has(key))return cache.get(key);
 const dir=path.join(temp,key);fs.mkdirSync(dir,{recursive:true});fs.cpSync(path.join(__dirname,'fixtures',String(spec.sourceSet)),dir,{recursive:true});
 if(candidate){fs.cpSync(path.join(release,'candidate',String(spec.sourceSet)),dir,{recursive:true});fs.cpSync(path.join(release,'bucket-settlement'),path.join(dir,'bucket-settlement'),{recursive:true});}
 const mod=require(path.join(dir,spec.path)),guarded=require(path.join(dir,'_qr_checkin/admin-firestore.cjs')).getFirestore();
 const options={db:guarded,FieldValue,clock:()=>NOW,now:()=>NOW,serverTimestamp:()=>FieldValue.serverTimestamp(),bucketRuntime:production?'production':'emulator'};
 const fn=spec.function==='ladderAutoSettlement'?mod._ladderAutoSettlementTest.createSettlementService(options).settle:mod.createLadderSettlement(options);
 const invoke=async(overrides={})=>{if(spec.function==='ladderAutoSettlement')return fn(code);const root=(await db.doc('tournaments/'+code).get()).data();return fn({code,actor:{uid:'admin',name:'Admin'},...(candidate&&root?.scoreStorage?{expectedRoom:{roomId:root.scoreStorage.roomId,epoch:root.scoreStorage.epoch}}:{}),...overrides});};cache.set(key,invoke);return invoke;
}
async function clear(){for(const name of collections)await db.recursiveDelete(db.collection(name));}
async function seed(f){await clear();const rows=[...f.m.rows];for(let i=0;i<rows.length;i+=400){const b=db.batch();for(const [p,v]of rows.slice(i,i+400))b.set(db.doc(p),v);await b.commit();}}
function normalize(v){if(v&&typeof v.toMillis==='function')return '<server-timestamp>';if(typeof v==='string'&&/^[\[{]/.test(v)){try{return normalize(JSON.parse(v));}catch{}}if(Array.isArray(v))return v.map(normalize);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]));return v;}
async function state(){const out=[];async function walk(col){for(const ref of await col.listDocuments()){const s=await ref.get();if(s.exists)out.push([ref.path,normalize(s.data())]);for(const child of await ref.listCollections())await walk(child);}}for(const col of collections)await walk(db.collection(col));return out.sort(([a],[b])=>a.localeCompare(b));}
(async()=>{let checks=0;
 try{
  for(const spec of specs){
   for(const qr of [false,true]){const f=fixture({bucket:false,qr});let original;for(const candidate of [false,true]){await seed(f);const result=await handler(spec,candidate)();assert(result.ok,result.reason);const view={result:normalize(result),state:await state()};if(!candidate)original=view;else assert.deepEqual(view,original,spec.function+' native legacy drift');}checks++;}
   for(const qr of [false,true])for(const courts of [4,6,12]){
    const f=fixture({qr,courts});await seed(f);const refs=f.buckets.map(b=>db.doc('tournaments/'+code+'/matchBuckets/'+b.bucketId)),before=await db.getAll(...refs),invoke=handler(spec,true),r=await invoke();assert(r.ok,r.reason);
    const top=(await db.doc('tournaments/'+code).get()).data(),pub=(await db.doc('publicTournaments/'+code).get()).data();assert.equal(top.archiveStatus,'completed');assert.equal(JSON.parse(top.data).championId,'p1');assert.equal(JSON.parse(pub.bracketView).matches.find(m=>m.id==='final').scoreA,4);assert.equal(pub.scoreBucketProjection.versions['court-1'],7);assert(!JSON.stringify(pub).includes('PRIVATE_UID'));assert(!('sourceCreatedAt'in pub.bucketSettlement));assert(!('actorUid'in pub.bucketSettlement));
    assert.equal((await db.doc('ladderPlayers/u1').get()).data().seasonPoints,105);assert.equal((await db.collection('ladderTransactions').get()).size,4);
    const after=await db.getAll(...refs);assert(before.every((s,i)=>s.updateTime.isEqual(after[i].updateTime)));if(qr)assert.equal(top.qrCheckinRevision,2);
    const saved=await state();assert((await invoke()).alreadyAwarded);assert.deepEqual(await state(),saved);checks++;
   }
   for(const marker of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}])for(const side of ['tournaments','publicTournaments']){const f=fixture();await seed(f);await db.doc(side+'/'+code).update({[marker]:value});const before=await state(),r=await handler(spec,true)();assert.equal(r.ok,false);assert.deepEqual(await state(),before);checks++;}
   const failures={
    missing:async()=>db.doc('tournaments/'+code+'/matchBuckets/court-2').delete(),
    wrongEpoch:async()=>db.doc('tournaments/'+code+'/matchBuckets/court-1').update({epoch:'other'}),
    corrupt:async()=>db.doc('tournaments/'+code+'/matchBuckets/court-1').update({matches:'{invalid'}),
    missingRevision:async()=>db.doc('tournaments/'+code+'/matchBuckets/court-1').update({revision:FieldValue.delete()}),
    oldAwards:async()=>db.doc('tournaments/'+code).update({ladderPointsAwarded:true}),
    oldLedger:async()=>db.doc('ladderTransactions/'+code+'_u1').set({pointsEarned:999}),
    cancelled:async()=>db.doc('tournaments/'+code+'/registrations/u1').update({status:'cancelled'}),
    disabled:async()=>db.doc('systemConfig/fourCourtScoreBuckets').update({settlementEnabled:false}),
    publicAhead:async()=>db.doc('publicTournaments/'+code).update({scoreBucketProjection:{epoch:'epoch-1',versions:{'court-1':99,'court-2':7}}}),
    qrMismatch:async()=>db.doc('tournaments/'+code).update({qrCheckinManaged:true,qrCheckinRevision:1}),
    expiredSeason:async()=>db.doc('ladderSystem/current').update({endAt:NOW-1}),
    // Both failures happen after player/log writes are queued, proving abort
    // rolls back the entire award transaction, not only the parent documents.
    sizeBudget:async()=>db.doc('tournaments/'+code).update({largeMetadata:'x'.repeat(760000)}),
    badPublicView:async()=>db.doc('publicTournaments/'+code).update({bracketView:'{invalid'}),
    replacedParent:async()=>{const ref=db.doc('tournaments/'+code),d=(await ref.get()).data();await ref.delete();await ref.set(d);},
    stateCancelled:async()=>{const ref=db.doc('tournaments/'+code),d=(await ref.get()).data(),s=JSON.parse(d.data);s.meta.eventCancelled=true;await ref.update({data:JSON.stringify(s)});},
    stateTest:async()=>{const ref=db.doc('tournaments/'+code),d=(await ref.get()).data(),s=JSON.parse(d.data);s.testMode=true;await ref.update({data:JSON.stringify(s)});},
    stateClosed:async()=>{const ref=db.doc('tournaments/'+code),d=(await ref.get()).data(),s=JSON.parse(d.data);s.systemClosed=true;await ref.update({data:JSON.stringify(s)});},
    notStarted:async()=>{const ref=db.doc('tournaments/'+code),d=(await ref.get()).data(),s=JSON.parse(d.data);delete s.startedAt;await ref.update({data:JSON.stringify(s)});},
   };
   for(const [name,mutate]of Object.entries(failures)){await seed(fixture());await mutate();const before=await state(),r=await handler(spec,true)();assert.equal(r.ok,false,spec.function+' '+name);assert.deepEqual(await state(),before,spec.function+' '+name+' partial writes');checks++;}
   // The production constructor never inherits the Emulator bypass.
   {await seed(fixture());const before=await state(),r=await handler(spec,true,{production:true})();assert.equal(r.ok,false);assert.match(r.reason,/runtime-disabled|project-mismatch/);assert.deepEqual(await state(),before);checks++;}
   // Preserve career totals for S0 and explicitly non-career seasons.
   for(const currentSeason of ['S0','S1']){const f=fixture();f.m.put('ladderSystem/current',{status:'active',currentSeason,countsTowardCareer:false,isTrialSeason:currentSeason==='S0'});for(let i=1;i<=4;i++)f.m.put('ladderPlayers/u'+i,{...f.m.rows.get('ladderPlayers/u'+i),currentSeason});await seed(f);const r=await handler(spec,true)();assert(r.ok,r.reason);assert.equal((await db.doc('ladderPlayers/u1').get()).data().careerPoints,10);checks++;}
   console.log('Checking 160 and 321 player capacity for '+spec.function);
   // Six-court / 160-player transaction: real points + ledger + archive writes.
   {const f=largeFixture(160);await seed(f);const r=await handler(spec,true)();assert(r.ok,r.reason);assert.equal((await db.collection('ladderTransactions').get()).size,160);assert.equal((await db.doc('ladderPlayers/u0').get()).data().seasonPoints,246);assert.equal((await db.doc('tournaments/'+code).get()).data().archiveStatus,'completed');checks++;}
   {const f=largeFixture(321,12);await seed(f);const r=await handler(spec,true)();assert.equal(r.ok,false);assert.equal(r.reason,'eligible-player-limit');assert.equal((await db.collection('ladderTransactions').get()).size,0);assert.equal((await db.doc('ladderPlayers/u0').get()).data().seasonPoints,0);assert.equal((await db.doc('tournaments/'+code).get()).data().archiveStatus,'ongoing');checks++;}
  }
  // Both services read the same buckets and contend on the same ledger/root.
  for(const qr of [false,true]){await seed(fixture({qr}));const r=await Promise.all(specs.map(s=>handler(s,true)()));assert(r.every(x=>x.ok));assert.equal((await db.doc('ladderPlayers/u1').get()).data().seasonPoints,105);assert.equal((await db.collection('ladderTransactions').get()).size,4);if(qr)assert.equal((await db.doc('tournaments/'+code).get()).data().qrCheckinRevision,2);checks++;}
  {
   console.log('Checking concurrent manual and automatic settlement for 320 players');
   await seed(largeFixture(320,12));
   const results=await Promise.all(specs.map(spec=>handler(spec,true)()));
   assert(results.every(result=>result.ok),JSON.stringify(results.map(result=>result.reason)));
   assert.equal(results.filter(result=>result.alreadyAwarded).length,1);
   const ledger=await db.collection('ladderTransactions').get();
   assert.equal(ledger.size,320);
   assert(ledger.docs.every(document=>document.data().pointsEarned>0));
   assert.equal((await db.doc('ladderPlayers/u0').get()).data().totalEvents,1);
   assert.equal((await db.doc('tournaments/'+code).get()).data().archiveStatus,'completed');
   assert.equal((await db.doc('publicTournaments/'+code).get()).data().archiveStatus,'completed');
   checks++;
  }
  const automatic=specs.find(spec=>spec.function==='ladderAutoSettlement');
  {
   const f=largeFixture(320,12);
   const {scoreStorage,...legacyRoom}=f.m.rows.get('tournaments/'+code);
   const {scoreBucketProjection,...legacyPublic}=f.m.rows.get('publicTournaments/'+code);
   f.m.put('tournaments/'+code,legacyRoom);
   f.m.put('publicTournaments/'+code,legacyPublic);
   await seed(f);
   const result=await handler(automatic,true)();
   assert.equal(result.reason,'eligible-player-limit');
   assert.equal((await db.collection('ladderTransactions').get()).size,0);
   checks++;
  }
  for(const failed of specs){
   console.log('Checking 320-player rollback and cross-service retry after '+failed.function);
   await seed(largeFixture(320,12));
   const room=db.doc('tournaments/'+code),publicRoom=db.doc('publicTournaments/'+code);
   const {bracketView}=(await publicRoom.get()).data();
   await publicRoom.update({bracketView:'{invalid'});
   const before=await db.getAll(room,publicRoom);
   const result=await handler(failed,true)();
   assert.equal(result.ok,false);
   assert.equal(result.reason,'bucket-public-corrupt');
   const after=await db.getAll(room,publicRoom);
   assert(before.every((snapshot,index)=>snapshot.updateTime.isEqual(after[index].updateTime)));
   assert.equal((await db.collection('ladderTransactions').get()).size,0);
   const unawarded=await db.collection('ladderPlayers').get();
   assert.equal(unawarded.size,320);
   assert(unawarded.docs.every(document=>document.data().seasonPoints===0));

   await publicRoom.update({bracketView});
   const retry=specs.find(spec=>spec!==failed);
   const recovered=await handler(retry,true)();
   assert(recovered.ok,recovered.reason);
   assert.equal((await handler(failed,true)()).alreadyAwarded,true);
   assert.equal((await db.collection('ladderTransactions').get()).size,320);
   const awarded=await db.collection('ladderPlayers').get();
   assert(awarded.docs.every(document=>document.data().seasonPoints>0&&document.data().totalEvents===1));
   assert.equal((await room.get()).data().archiveStatus,'completed');
   assert.equal((await publicRoom.get()).data().archiveStatus,'completed');
   checks++;
  }
  const boundManual=specs.find(s=>s.function==='settleLadderTournament');
 for(const expectedRoom of [null,{}, {roomId:'wrong',epoch:'epoch-1'}, {roomId:'room-1',epoch:'old'}, {roomId:'room-1',epoch:'epoch-1',extra:1}]){await seed(fixture());const before=await state();const r=await handler(boundManual,true)({expectedRoom});assert.equal(r.ok,false);assert.deepEqual(await state(),before);checks++;}
 {await seed(fixture());assert((await handler(boundManual,true)()).ok);await db.doc('users/admin').update({active:false});const before=await state();assert.equal((await handler(boundManual,true)()).ok,false);assert.deepEqual(await state(),before);checks++;}
 {await seed(fixture({bucket:false}));const before=await state();assert.equal((await handler(boundManual,true)({expectedRoom:{roomId:'room-1',epoch:'epoch-1'}})).ok,false);assert.deepEqual(await state(),before);checks++;}
 console.log(JSON.stringify({nativeSettlementChecks:checks,project,productionWrites:0,productionRequests:0,scope:'real SDK, QR proxy, 160-player awards and 320-player cross-service contention; synthetic auth and injected business clock'}));
 }finally{await clear();await db.terminate();await deleteApp(app);fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
