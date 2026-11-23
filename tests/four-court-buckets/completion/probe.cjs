'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {fixture,largeFixture,NOW,code}=require('./fixture.cjs'),release=path.resolve(__dirname,'../../../release/buckets/completion');
const {createGeneralCompletion}=require(path.join(release,'general-completion.cjs')),A=require(path.join(release,'certificate.cjs')),H=require(path.join(release,'hosting-guard.cjs'));
const {completion}=require(path.join(__dirname,'fixtures/hosting-core.js'));
const request=f=>({auth:{uid:'admin'},data:{code,roomId:f.state.id,epoch:f.manifest.epoch}});
const invoke=f=>createGeneralCompletion(f.m.db,{runtime:'emulator',env:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188'},clock:()=>NOW})(request(f));
const dump=f=>JSON.stringify([...f.m.rows]);
async function count(f){return f.m.db.runTransaction(async tx=>{const root=await tx.get(f.m.db.doc('tournaments/'+code)),pub=await tx.get(f.m.db.doc('publicTournaments/'+code)),profile=await tx.get(f.m.db.doc('users/admin')),ledger=f.m.db.doc('hostCompletionLedger/'+code),prior=await tx.get(ledger);return H.countCertified({db:f.m.db,tx,root,pub,profile,prior,ledger,stats:f.m.db.doc('hostStats/admin'),FieldValue:{serverTimestamp:()=>NOW,increment:n=>({__increment:n})},completion});});}
if(require.main===module)(async()=>{let checks=0;
 for(const qr of [false,true])for(const courts of [4,6,12]){
  const f=fixture({qr,courts});f.top.createdBy='admin';f.m.put('tournaments/'+code,f.top);const b=JSON.stringify(f.buckets),players=dump(f).match(/ladderPlayers[^]*?systemConfig/);const r=await invoke(f);assert(r.ok);
  const top=f.m.rows.get('tournaments/'+code),pub=f.m.rows.get('publicTournaments/'+code),state=JSON.parse(top.data);assert.equal(state.championId,'p1');assert.equal(state.archiveStatus,'completed');assert.equal(state.settlementRoute,'no-ladder');assert.equal(top.ladderPointsAwarded,undefined);assert.equal(f.m.writes.filter(w=>/ladderPlayers|ladderTransactions/.test(w.path)).length,0);assert.equal(JSON.stringify(f.buckets),b);assert(!JSON.stringify(pub).includes('PRIVATE_UID'));assert(!('actorUid'in pub.bucketCompletion));if(qr)assert.equal(top.qrCheckinRevision,2);
  const before=dump(f);assert((await invoke(f)).alreadyCompleted);assert.equal(dump(f),before);checks++;
  assert.equal(await count(f),'admin');assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);assert(f.m.rows.has('hostAwardQueue/admin'));await count(f);assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);checks++;
 }
 {const f=largeFixture(160);const r=await invoke(f);assert(r.ok);assert.equal(JSON.parse(f.m.rows.get('tournaments/'+code).data).players.length,160);assert.equal(f.m.writes.filter(w=>/ladderPlayers|ladderTransactions/.test(w.path)).length,0);checks++;}
 const failures={
  missing:f=>f.m.remove('tournaments/'+code+'/matchBuckets/court-2'),
  epoch:f=>f.m.put('tournaments/'+code+'/matchBuckets/court-1',{...f.buckets[0],epoch:'other'}),
  corrupt:f=>f.m.put('tournaments/'+code+'/matchBuckets/court-1',{...f.buckets[0],matches:'{bad'}),
  disabled:f=>f.m.put('systemConfig/fourCourtScoreBuckets',{enabled:true}),
  inactive:f=>f.m.put('users/admin',{active:false,role:'admin'}),
  ordinaryPlayer:f=>f.m.put('users/admin',{active:true,role:'player'}),
  notStarted:f=>{const s=JSON.parse(f.top.data);delete s.startedAt;f.top.data=JSON.stringify(s);f.m.put('tournaments/'+code,f.top);},
  ranked:f=>{const s=JSON.parse(f.top.data);s.meta.ladderMode='ranked';f.m.put('tournaments/'+code,{...f.top,ladderMode:'ranked',data:JSON.stringify(s)});},
  awarded:f=>f.m.put('tournaments/'+code,{...f.top,ladderPointsAwarded:true}),
  unsupported:f=>{const s=JSON.parse(f.top.data);s.meta.formatType='double';f.m.put('tournaments/'+code,{...f.top,data:JSON.stringify(s)});},
  badPublic:f=>f.m.put('publicTournaments/'+code,{...f.pub,bracketView:'bad'}),
  aheadPublic:f=>f.m.put('publicTournaments/'+code,{...f.pub,scoreBucketProjection:{epoch:'epoch-1',versions:{'court-1':99,'court-2':7}}}),
  incomplete:f=>{const b={...f.buckets[0]},rows=JSON.parse(b.matches);rows.find(m=>m.id==='final').completed=false;b.matches=JSON.stringify(rows);f.m.put('tournaments/'+code+'/matchBuckets/court-1',b);},
  tooBig:f=>f.m.put('publicTournaments/'+code,{...f.pub,padding:'x'.repeat(760000)}),
 };
 for(const [name,change]of Object.entries(failures)){const f=fixture();change(f);const before=dump(f);await assert.rejects(()=>invoke(f),undefined,name);assert.equal(dump(f),before);checks++;}
 for(const side of ['tournaments','publicTournaments'])for(const key of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}]){const f=fixture(),p=side+'/'+code;f.m.put(p,{...f.m.rows.get(p),[key]:value});const before=dump(f);await assert.rejects(()=>invoke(f));assert.equal(dump(f),before);checks++;}
 for(const mutate of [r=>delete r.auth,r=>r.data.epoch='old',r=>r.data.roomId='other',r=>r.data.score=999]){const f=fixture(),r=request(f);mutate(r);await assert.rejects(()=>createGeneralCompletion(f.m.db,{runtime:'emulator',env:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188'}})(r));assert.equal(f.m.writes.length,0);checks++;}
 {const f=fixture();await assert.rejects(()=>createGeneralCompletion(f.m.db)(request(f)),/runtime-disabled/);checks++;}
 for(const change of [f=>{const p='tournaments/'+code,t=f.m.rows.get(p);f.m.put(p,{...t,bucketCompletion:{...t.bucketCompletion,stateDigest:'bad'}});},f=>f.m.put('hostCompletionLedger/'+code,{ownerUid:'admin'}),f=>f.m.put('users/admin',{active:false,role:'admin'})]){
  const f=fixture();await invoke(f);change(f);const before=dump(f);if(f.m.rows.get('users/admin').active===false)assert.equal(await count(f),null);else await assert.rejects(()=>count(f));assert.equal(dump(f),before);checks++;
 }
 {const f=fixture();f.m.interfere=()=>f.m.put('users/admin',{active:false,role:'admin'});await assert.rejects(()=>invoke(f));assert.equal(f.m.writes.length,0);checks++;}
 {const f=fixture();const r=await Promise.all([invoke(f),invoke(f)]);assert(r.every(x=>x.ok));assert.equal(r.filter(x=>!x.alreadyCompleted).length,1);checks++;}
 console.log(JSON.stringify({generalCompletionChecks:checks,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={request,invoke,count};
