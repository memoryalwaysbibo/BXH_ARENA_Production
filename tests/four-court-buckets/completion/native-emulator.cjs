'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const project='demo-bxh-four-court-buckets';assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,FieldValue}=require('firebase-admin/firestore');
const {fixture,largeFixture,NOW,code}=require('./fixture.cjs'),{request}=require('./probe.cjs'),release=path.resolve(__dirname,'../../../release/buckets/completion'),A=require(path.join(release,'certificate.cjs')),H=require(path.join(release,'hosting-guard.cjs')),{createGeneralCompletion}=require(path.join(release,'general-completion.cjs')),{completion,stateOf}=require('./fixtures/hosting-core.js');
const app=initializeApp({projectId:project}),db=getFirestore(app);db.settings({host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
const names=['users','tournaments','publicTournaments','systemConfig','ladderPlayers','ladderTransactions','ladderSystem','hostCompletionLedger','hostStats','hostAwardQueue'];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bucket-hosting-native-'));
function hosting(i,original=false){
 const dir=path.join(temp,String(i)+(original?'-original':'-candidate'));fs.mkdirSync(path.join(dir,'_qr_checkin'),{recursive:true});
 fs.copyFileSync(original?path.join(__dirname,'fixtures',String(i),'hosting.js'):path.join(release,'hosting',String(i),'hosting.js'),path.join(dir,'hosting.js'));
 fs.copyFileSync(path.join(release,'hosting',String(i),'hosting-core.js'),path.join(dir,'hosting-core.js'));
 fs.mkdirSync(path.join(dir,'bucket-completion'),{recursive:true});
 for(const name of ['certificate.cjs','hosting-guard.cjs'])fs.copyFileSync(path.join(release,name),path.join(dir,'bucket-completion',name));
 fs.cpSync(path.join(release,'protocol'),path.join(dir,'bucket-completion/protocol'),{recursive:true});
 for(const name of ['admin-firestore.cjs','guard-firestore.cjs','qr-checkin-fence.cjs'])fs.copyFileSync(path.join(__dirname,'fixtures/host-sync/_qr_checkin',name),path.join(dir,'_qr_checkin',name));
 return require(path.join(dir,'hosting.js'));
}
const handle=createGeneralCompletion(db,{runtime:'emulator',clock:()=>NOW});
async function seed(f){for(const name of names)await db.recursiveDelete(db.collection(name));const b=db.batch();for(const [p,v]of f.m.rows)b.set(db.doc(p),v);await b.commit();}
async function count(){return db.runTransaction(async tx=>{const root=await tx.get(db.doc('tournaments/'+code)),pub=await tx.get(db.doc('publicTournaments/'+code)),profile=await tx.get(db.doc('users/admin')),ledger=db.doc('hostCompletionLedger/'+code),prior=await tx.get(ledger);return H.countCertified({db,tx,root,pub,profile,prior,ledger,stats:db.doc('hostStats/admin'),FieldValue,completion});});}
const rebuild=()=>H.rebuildHost({db,uid:'admin',FieldValue,completion,stateOf});
function normalize(v){if(v?.toMillis)return '<timestamp>';if(Array.isArray(v))return v.map(normalize);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)]));return v;}
async function all(){const out=[];async function walk(col){for(const ref of await col.listDocuments()){const s=await ref.get();if(s.exists)out.push([ref.path,normalize(s.data())]);for(const child of await ref.listCollections())await walk(child);}}for(const name of names)await walk(db.collection(name));return out.sort(([a],[b])=>a.localeCompare(b));}
(async()=>{let checks=0;
 try{
 for(const qr of [false,true])for(const courts of [4,6,12]){
  const f=fixture({qr,courts});await seed(f);const refs=f.buckets.map(b=>db.doc('tournaments/'+code+'/matchBuckets/'+b.bucketId)),before=await db.getAll(...refs);assert((await handle(request(f))).ok);
  const top=(await db.doc('tournaments/'+code).get()).data(),pub=(await db.doc('publicTournaments/'+code).get()).data();assert.equal(top.archiveStatus,'completed');assert.equal(JSON.parse(top.data).championId,'p1');assert.equal(top.ladderPointsAwarded,undefined);assert(!JSON.stringify(pub).includes('PRIVATE_UID'));assert.equal((await db.collection('ladderTransactions').get()).size,0);assert.equal((await db.doc('ladderPlayers/u1').get()).data().seasonPoints,5);if(qr)assert.equal(top.qrCheckinRevision,2);
  const after=await db.getAll(...refs);assert(before.every((s,i)=>s.updateTime.isEqual(after[i].updateTime)));const snap=await all();assert((await handle(request(f))).alreadyCompleted);assert.deepEqual(await all(),snap);checks++;
  await Promise.all([count(),count(),rebuild()]);assert.equal((await db.doc('hostStats/admin').get()).data().completedHostedCount,1);assert((await db.doc('hostAwardQueue/admin').get()).exists);assert.equal((await db.collection('hostCompletionLedger').get()).size,1);checks++;
  await db.doc('hostStats/admin').update({completedHostedCount:999});assert.equal(await rebuild(),1);checks++;
 }
 {const f=largeFixture(160);await seed(f);assert((await handle(request(f))).ok);assert.equal(JSON.parse((await db.doc('tournaments/'+code).get()).data().data).players.length,160);assert.equal((await db.collection('ladderTransactions').get()).size,0);await Promise.all([count(),rebuild()]);assert.equal((await db.doc('hostStats/admin').get()).data().completedHostedCount,1);checks++;}
 for(const i of [15,16])for(const qr of [false,true]){
  const f=fixture({qr});await seed(f);await handle(request(f));const fn=hosting(i).preserveCompletedRoomAndCountHost;
  assert.equal(typeof fn.run,'function');const event={params:{code},data:{after:await db.doc('tournaments/'+code).get()}};
  await fn.run(event);await fn.run(event);assert.equal((await db.doc('hostStats/admin').get()).data().completedHostedCount,1);checks++;
 }
 for(const side of ['tournaments','publicTournaments'])for(const marker of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}]){const f=fixture();await seed(f);await db.doc(side+'/'+code).update({[marker]:value});const before=await all();await assert.rejects(()=>handle(request(f)));assert.deepEqual(await all(),before);checks++;}
 const changes={
  missing:()=>db.doc('tournaments/'+code+'/matchBuckets/court-2').delete(),
  epoch:()=>db.doc('tournaments/'+code+'/matchBuckets/court-1').update({epoch:'other'}),
  corrupt:()=>db.doc('tournaments/'+code+'/matchBuckets/court-1').update({matches:'bad'}),
  inactive:()=>db.doc('users/admin').update({active:false}),
  gate:()=>db.doc('systemConfig/fourCourtScoreBuckets').update({completionEnabled:false}),
  awarded:()=>db.doc('tournaments/'+code).update({ladderPointsAwarded:true}),
  tooBig:()=>db.doc('publicTournaments/'+code).update({padding:'x'.repeat(760000)}),
  qrMismatch:()=>db.doc('publicTournaments/'+code).update({qrCheckinRevision:99}),
 };
 for(const [key,change]of Object.entries(changes)){const f=fixture({qr:true});await seed(f);await change();const before=await all();await assert.rejects(()=>handle(request(f)),undefined,key);assert.deepEqual(await all(),before);checks++;}
 {const f=fixture();await seed(f);await assert.rejects(()=>createGeneralCompletion(db)(request(f)),/runtime-disabled/);checks++;}
 {const f=fixture();await seed(f);const result=await Promise.all([handle(request(f)),handle(request(f))]);assert.equal(result.filter(x=>!x.alreadyCompleted).length,1);checks++;}
 for(const bad of ['certificate','ledger','migration']){
  const f=fixture();await seed(f);await handle(request(f));await count();await db.doc('hostStats/admin').update({completedHostedCount:7});
  if(bad==='certificate')await db.doc('tournaments/'+code).update({'bucketCompletion.stateDigest':'bad'});
  if(bad==='ledger')await db.doc('hostCompletionLedger/'+code).update({sourceCreatedAt:'old'});
  if(bad==='migration')await db.doc('tournaments/'+code).update({bucketMigration:null});
  const before=await all();await assert.rejects(()=>rebuild());assert.deepEqual(await all(),before);checks++;
 }
 {const f=fixture();await seed(f);await db.doc('hostStats/admin').set({completedHostedCount:9});assert.equal(await rebuild(),0);assert.equal((await db.collection('hostCompletionLedger').get()).size,0);checks++;}
 // New root physical generation cannot inherit the old root's children/certificate.
 {const f=fixture();await seed(f);await handle(request(f));const top=(await db.doc('tournaments/'+code).get()).data();await db.doc('tournaments/'+code).delete();await db.doc('tournaments/'+code).set(top);const before=await all();await assert.rejects(()=>handle(request(f)));assert.deepEqual(await all(),before);checks++;}
 // Exercise the independently captured callable and the original QR proxy.
 for(const qr of [false,true])for(const community of [false,true]){
  let golden;
  for(const original of [true,false]){
   const f=fixture({bucket:false,qr}),state={...f.state,archiveStatus:'completed',completedAt:NOW};
   if(community){state.meta={...state.meta,eventAuthority:'community'};state.expiresAtMs=NOW+5000;}
   f.m.put('tournaments/'+code,{...f.top,data:JSON.stringify(state),...(community?{eventAuthority:'community',expiresAt:NOW+5000}:{})});
   if(community)f.m.put('publicTournaments/'+code,{...f.pub,expiresAt:NOW+5000});
   await seed(f);const result=await hosting('host-sync',original).syncMyHostingProgress.run({auth:{uid:'admin'},data:{uid:'other'}});assert.equal(result.completedHostedCount,1);
   const rows=(await all()).filter(([p])=>!p.startsWith('hostAwardQueue/'));
   if(original)golden=rows;else assert.deepEqual(rows,golden);
   assert.equal((await db.doc('hostStats/other').get()).exists,false);
  }
  checks++;
 }
 for(const qr of [false,true]){
  const f=fixture({qr});await seed(f);await handle(request(f));const sync=hosting('host-sync').syncMyHostingProgress.run;
  await Promise.all([count(),sync({auth:{uid:'admin'}}),sync({auth:{uid:'admin'}})]);assert.equal((await db.doc('hostStats/admin').get()).data().completedHostedCount,1);assert.equal((await db.collection('hostCompletionLedger').get()).size,1);checks++;
 }
 for(const bad of ['no-auth','inactive','revoked-after-preflight','certificate','migration','ledger']){
  const f=fixture();await seed(f);await handle(request(f));await db.doc('hostStats/admin').set({completedHostedCount:7});
  if(bad==='inactive')await db.doc('users/admin').update({active:false});
  if(bad==='certificate')await db.doc('tournaments/'+code).update({'bucketCompletion.stateDigest':'bad'});
  if(bad==='migration')await db.doc('tournaments/'+code).update({bucketMigration:null});
  if(bad==='ledger')await db.doc('hostCompletionLedger/'+code).set({ownerUid:'other'});
  const before=await all(),sync=hosting('host-sync').syncMyHostingProgress.run,run=db.runTransaction.bind(db);
  try{
   if(bad==='revoked-after-preflight'){let first=true;db.runTransaction=async(...args)=>{if(first){first=false;await db.doc('users/admin').update({active:false});}return run(...args);};}
   await assert.rejects(()=>sync(bad==='no-auth'?{}:{auth:{uid:'admin'}}));
  }finally{db.runTransaction=run;}
  const expected=JSON.parse(JSON.stringify(before));if(bad==='revoked-after-preflight')expected.find(([p])=>p==='users/admin')[1].active=false;
  assert.deepEqual(await all(),expected);checks++;
 }
 console.log(JSON.stringify({nativeCompletionChecks:checks,project,productionRequests:0,productionWrites:0,scope:'real Firestore SDK transactions, synthetic auth and clock; no browser/Eventarc'}));
 }finally{await deleteApp(app);fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
