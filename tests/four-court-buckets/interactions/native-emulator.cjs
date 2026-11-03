'use strict';
// Real Admin SDK and native transactions, confined to a fixed loopback demo project.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const project='demo-bxh-bucket-interactions';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert(/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''));
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,FieldPath}=require('firebase-admin/firestore');
const {fixture,load}=require('./probe.cjs');
const specs=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../release/buckets/interactions/patch-manifest.json'))).patches;
const app=initializeApp({projectId:project},'bucket-interaction-emulator'),db=getFirestore(app);db.settings({host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
const clone=x=>JSON.parse(JSON.stringify(x));
async function clear(){for(const name of ['tournaments','publicTournaments','users','familyPlayers','courtCalls'])await db.recursiveDelete(db.collection(name));}
function seeds(spec){const f=fixture(spec),rows=new Map([...f.m.rows].map(([p,v])=>[p,clone(v)]));for(const [p,d]of rows)if(d.game){d.gameJson=JSON.stringify(d.game);delete d.game;}return {...f,rows};}
async function seed(rows){const batch=db.batch();for(const [p,v]of rows)batch.set(db.doc(p),v);await batch.commit();}
const adapter={db,sdk:{FieldValue,FieldPath}};
(async()=>{let checks=0;
 try{
  for(const spec of specs){
   const f=seeds(spec);let baseline;
   for(const patched of [false,true]){
    await clear();await seed(f.rows);const result=await load(spec,patched,adapter)(f.request);
    const canonical=await db.getAll(db.doc('tournaments/BXH-TEST01'),db.doc('publicTournaments/BXH-TEST01'));
    const value=JSON.parse(JSON.stringify({result,roots:canonical.map(s=>s.data())}));
    if(!patched)baseline=value;else assert.deepEqual(value,baseline,spec.function+' native unmarked result/root mismatch');
   }checks++;
   // Keep real receipts/child ledgers from success: ownership checks must still win.
   const handler=load(spec,true,adapter);
   for(const marker of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])for(const value of [null,false,'invalid',{}, {phase:'migrating'}, {phase:'active'}, {status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
    const a=clone(f.rows.get('tournaments/BXH-TEST01')),b=clone(f.rows.get('publicTournaments/BXH-TEST01'));a.data='{invalid';(side==='tournaments'?a:b)[marker]=value;
    const refs=[db.doc('tournaments/BXH-TEST01'),db.doc('publicTournaments/BXH-TEST01')];const batch=db.batch();batch.set(refs[0],a);batch.set(refs[1],b);await batch.commit();
    const before=await db.getAll(...refs);await assert.rejects(handler(f.request),/bucket-scoring-required/);const after=await db.getAll(...refs);
    assert(before.every((s,i)=>s.updateTime.isEqual(after[i].updateTime)),spec.function+' changed a marked root');checks++;
   }
  }
  console.log(JSON.stringify({nativeEmulatorChecks:checks,project,productionWrites:0,productionRequests:0,scope:'real Admin SDK/transactions; synthetic data and request auth context'}));
 }finally{await clear();await db.terminate();await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1;});
