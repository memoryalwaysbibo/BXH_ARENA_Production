'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {fixture,NOW,code}=require('./fixture.cjs'),{invoke,count}=require('./probe.cjs'),release=path.resolve(__dirname,'../../../release/buckets/completion'),H=require(path.join(release,'hosting-guard.cjs')),{completion,stateOf}=require('./fixtures/hosting-core.js');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const {guardFirestore}=require('./fixtures/host-sync/_qr_checkin/guard-firestore.cjs');
const FieldValue={serverTimestamp:()=>NOW,increment:n=>({__increment:n})},options=f=>({db:f.m.db,uid:'admin',FieldValue,completion,stateOf});
function load(f,i,candidate){const file=path.join(candidate?release:__dirname,candidate?'hosting/'+i+'/hosting.js':'fixtures/'+i+'/hosting.js'),exports={};vm.runInNewContext(fs.readFileSync(file,'utf8'),{exports,process:{env:{GCLOUD_PROJECT:'bxh-arena'}},console,require:name=>{
 if(name==='firebase-functions/v2/firestore')return {onDocumentWritten:(_,fn)=>fn};if(name==='firebase-functions/v2/https')return {onCall:(_,fn)=>fn,HttpsError};if(name==='firebase-functions/v2/scheduler')return {onSchedule:(_,fn)=>fn};
 if(name==='./_qr_checkin/admin-firestore.cjs')return {getFirestore:()=>guardFirestore(f.m.db),FieldValue,FieldPath:{documentId:()=> '__name__'}};
 if(name==='./hosting-core')return {completion,stateOf};if(name==='./bucket-completion/hosting-guard.cjs')return H;throw Error(name);
 }},{filename:file});return exports;}
if(require.main===module)(async()=>{let checks=0;
 for(const i of [15,16]){
  // Exercise the actual trigger before its outside queue set. The fixture DB adds
  // a document set boundary solely to capture that pre-existing post-transaction call.
  for(const candidate of [false,true]){const f=fixture({bucket:false});const s=f.state;s.archiveStatus='completed';s.completedAt=NOW;f.m.put('tournaments/'+code,{...f.top,createdBy:'admin',data:JSON.stringify(s)});const doc=f.m.db.doc;f.m.db.doc=p=>({...doc(p),set:async v=>f.m.put(p,{...f.m.rows.get(p),...v})});const fn=load(f,i,candidate);await fn.preserveCompletedRoomAndCountHost({params:{code},data:{after:f.m.snapshot('tournaments/'+code)}});assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);checks++;}
  {const f=fixture();await invoke(f);const old=f.m.snapshot('tournaments/'+code);const fn=load(f,i,true);f.m.remove('tournaments/'+code);f.m.put('tournaments/'+code,{...f.top,data:JSON.stringify({...f.state,archiveStatus:'completed',completedAt:NOW})});await fn.preserveCompletedRoomAndCountHost({params:{code},data:{after:old}});assert(!f.m.rows.has('hostStats/admin'));checks++;}
 }
 for(const qr of [false,true]){
  const f=fixture({qr});await invoke(f);await count(f);f.m.put('hostStats/admin',{completedHostedCount:999});assert.equal(await H.rebuildHost(options(f)),1);assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);assert(f.m.rows.has('hostAwardQueue/admin'));checks++;
  const before=f.m.rows.get('hostStats/admin');const t=f.m.rows.get('tournaments/'+code);f.m.put('tournaments/'+code,{...t,bucketCompletion:{...t.bucketCompletion,stateDigest:'bad'}});await assert.rejects(()=>H.rebuildHost(options(f)));assert.deepEqual(f.m.rows.get('hostStats/admin'),before);checks++;
 }
 {const f=fixture();await invoke(f);const r=await Promise.all([count(f),count(f),H.rebuildHost(options(f))]);assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);checks++;}
 {const f=fixture();f.m.put('hostStats/admin',{completedHostedCount:4});f.m.put('tournaments/'+code,{...f.top,bucketMigration:null});await assert.rejects(()=>H.rebuildHost(options(f)));assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,4);checks++;}
 {const f=fixture();f.m.put('hostStats/admin',{completedHostedCount:4});assert.equal(await H.rebuildHost(options(f)),0);assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,0);assert(!f.m.rows.has('hostCompletionLedger/'+code));checks++;}
 {const f=fixture();await invoke(f);f.m.put('hostCompletionLedger/'+code,{ownerUid:'other'});f.m.put('hostStats/admin',{completedHostedCount:9});await assert.rejects(()=>H.rebuildHost(options(f)));assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,9);checks++;}
 // The conflict barrier must remain transactional but cannot precede ledger
 // validation. This order prevents a stats-reader/ledger-writer lock inversion.
 for(const qr of [false,true])for(const existingLedger of [false,true]){
  const f=fixture({qr});await invoke(f);if(existingLedger)await count(f);
  const run=f.m.db.runTransaction.bind(f.m.db);let attempts=0;
  f.m.db.runTransaction=(callback,...args)=>run(tx=>{
   attempts++;const reads=[];let writing=false;
   return callback(new Proxy(tx,{get(target,key){
    if(key==='get'||key==='getAll')return async(...refs)=>{
     assert(!writing,'all rebuild reads must precede writes');
     reads.push(...refs.map(ref=>ref.path));return target[key](...refs);
    };
    if(['set','create','update','delete'].includes(key))return(...params)=>{
     assert.equal(reads.at(-1),'hostStats/admin','stats conflict barrier must be the final read');
     assert(reads.indexOf('hostCompletionLedger/'+code)<reads.length-1,'ledger must precede stats');
     assert(f.buckets.every(b=>reads.includes('tournaments/'+code+'/matchBuckets/'+b.bucketId)),'bucket validation must precede stats');
     writing=true;return target[key](...params);
    };
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }}));
  },...args);
  // A concurrent stats change still invalidates the read and retries normally.
  f.m.interfere=()=>f.m.put('hostStats/admin',{completedHostedCount:999});
  assert.equal(await H.rebuildHost(options(f)),1);assert.equal(attempts,2);
  assert.equal(f.m.rows.get('hostStats/admin').completedHostedCount,1);checks++;
 }
 console.log(JSON.stringify({hostingChecks:checks,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});

module.exports={load,FieldValue};
