'use strict';
const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {applyHold}=require('./hold-core.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration-v3');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:process.env.GCLOUD_PROJECT}));
const digest=x=>createHash('sha256').update(x).digest('hex');
const percentile=(xs,p)=>xs.sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
async function wave(bucketCount,capacity=192){
 const code='BXH-'+randomBytes(5).toString('hex').toUpperCase();
 const room=db.doc('tournaments/'+code),ids=Array.from({length:capacity+1},(_,i)=>'p'+i);
 const ledgers=Array.from({length:bucketCount},(_,i)=>room.collection('registrationV3ExperimentBuckets').doc(String(i)));
 const batch=db.batch();batch.set(room,{registrationFlowVersion:3,capacity});
 for(const uid of ids)batch.set(room.collection('syntheticAccounts').doc(uid),{active:true});
 for(let i=0;i<bucketCount;i++)batch.set(ledgers[i],{capacity:Math.floor(capacity/bucketCount)+(i<capacity%bucketCount?1:0),occupiedCount:0,pendingReviewCount:0,confirmedCount:0,sequence:0,revision:0});
 await batch.commit();
 const tails=Array.from({length:bucketCount},()=>Promise.resolve());
 const admit=(i,fn)=>{const p=tails[i].then(fn);tails[i]=p.catch(()=>{});return p;};
 const stats={reads:0,attempts:0,writes:0,probes:0};
 async function submit(uid){
  const started=performance.now(),hold=room.collection('registrationV3Holds').doc(uid),receipt=room.collection('registrationV3Operations').doc(uid);
  const home=parseInt(digest(uid).slice(0,8),16)%bucketCount;
  for(let offset=0;offset<bucketCount;offset++){
   const i=(home+offset)%bucketCount;stats.probes++;
   const result=await admit(i,()=>db.runTransaction(async tx=>{
    stats.attempts++;stats.reads+=5;
    const [r,l,h,o,u]=await tx.getAll(room,ledgers[i],hold,receipt,room.collection('syntheticAccounts').doc(uid));
    assert.equal(r.data().registrationFlowVersion,3);assert.equal(u.data().active,true);
    if(o.exists)return o.data();
    if(h.exists)throw Error('duplicate-hold');
    const ledger=l.data();
    if(ledger.occupiedCount===ledger.capacity)return null;
    const x=applyHold(ledger,null,{action:'join',uid,operationId:'join-'+uid,now:Date.now()});
    const sequence=i+':'+x.hold.sequence;
    tx.set(ledgers[i],x.ledger);tx.create(hold,{...x.hold,sequence,bucket:i});tx.create(receipt,{sequence,bucket:i});
    return {sequence,bucket:i};
   }));
   if(result){stats.writes+=3;return {status:'ok',ms:performance.now()-started};}
  }
  return {status:'full',ms:performance.now()-started};
 }
 const start=performance.now(),out=await Promise.allSettled(ids.map(submit)),elapsedMs=performance.now()-start;
 const rows=await room.collection('registrationV3Holds').get();
 const values=out.filter(x=>x.status==='fulfilled').map(x=>x.value),success=values.filter(x=>x.status==='ok').length;
 const errors=out.filter(x=>x.status==='rejected').map(x=>String(x.reason.code||x.reason.message));
 const totals=(await db.getAll(...ledgers)).map(x=>x.data());
 assert.equal(rows.size,success);assert.equal(totals.reduce((n,x)=>n+x.occupiedCount,0),success);
 assert.equal(new Set(rows.docs.map(x=>x.data().sequence)).size,success);
 assert(success<=capacity);
 return {bucketCount,capacity,submitted:ids.length,success,full:values.filter(x=>x.status==='full').length,errors,elapsedMs:Math.round(elapsedMs),p50Ms:Math.round(percentile(values.map(x=>x.ms),.5)),p95Ms:Math.round(percentile(values.map(x=>x.ms),.95)),...stats,retries:stats.attempts-stats.probes};
}
(async()=>{const results=[];for(const n of [1,12])results.push(await wave(n));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.success!==192||r.full!==1||r.errors.length))process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.terminate());
