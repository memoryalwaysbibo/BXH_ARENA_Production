'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Fail closed before constructing Firebase clients.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const B=require('../../modules/scoring/four-court-buckets.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'four-court-lab'),db=getFirestore(app);
const results={kind:'isolated-four-court-bucket-candidate',project:process.env.GCLOUD_PROJECT,productionWrites:0,authorizationAndMigrationCertified:false,publicProjectionLive:false,cases:[]};
function barrier(count){
 let arrivals=0,release,reject;const promise=new Promise((yes,no)=>{release=yes;reject=no;});
 const timer=setTimeout(()=>reject(Error('barrier-timeout')),20000);
 return {async first(){if(++arrivals===count){clearTimeout(timer);release();}await promise;},close(){clearTimeout(timer);release();}};
}
function data(count,code){
 return {id:'lab-'+code,cloudCode:code,meta:{stations:count,formatType:'single'},matches:Array.from({length:count},(_,i)=>({id:'m'+(i+1),station:i+1,scoreA:0,scoreB:0}))};
}
async function run(count,mode,round){
 const code='BXH-LAB'+count+mode[0].toUpperCase()+round,m=B.manifest(code,'lab-'+code,count),base=data(count,code),room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 await room.set({data:JSON.stringify(base),updatedAt:1,scores:Object.fromEntries(base.matches.map(x=>[x.id,0]))});
 await pub.set({bracketView:JSON.stringify(base),updatedAt:1});
 if(mode==='bucket')for(let i=0;i<m.bucketCount;i++){const route=B.bucketForCourt(i*4+1);await room.collection('scoreBuckets').doc(route.id).set(B.initialBucket(m,route,base.matches));}
 const rootBefore=await room.get(),publicBefore=await pub.get(),gate=barrier(count),metrics=[];
 try{
  const operations=Array.from({length:count},(_,i)=>({station:i+1,matchId:'m'+(i+1),operationId:'lab-operation-'+String(round)+'-'+String(i+1).padStart(3,'0'),uid:'lab-ref'+(i+1)}));
  await Promise.all(operations.map(async op=>{
   const route=B.route(m,op.station),ref=mode==='bucket'?room.collection('scoreBuckets').doc(route.id):room;
   const receiptRef=ref.collection('operations').doc(B.operationKey(op.uid,op.operationId));
   const metric={station:op.station,bucket:route.id,attempts:0,ok:false,reason:null,elapsedMs:null};metrics.push(metric);
   const started=performance.now(),hash=crypto.createHash('sha256').update(JSON.stringify(op)).digest('hex');
   try{
    // Admin SDK transactions lock reads; align launches before starting them.
    await gate.first();
    const response=await db.runTransaction(async tx=>{
     metric.attempts++;
     const [snap,receipt]=await Promise.all([tx.get(ref),tx.get(receiptRef)]);
     if(receipt.exists){if(receipt.data().hash!==hash)throw Error('operation-conflict');return receipt.data().result;}
     const source=snap.data();if(!source)throw Error('missing-source');
     let next,result;
     if(mode==='bucket'){
      const change=B.applyScore(source,{...op,bucketId:route.id,expectedRevision:0,side:'A',points:1});
      next=change.bucket;result=change.result;
     }else{
      next={...source,scores:{...source.scores,[op.matchId]:(source.scores[op.matchId]||0)+1}};
      result={ok:true,matchId:op.matchId,scoreA:next.scores[op.matchId]};
     }
     tx.update(ref,next);tx.create(receiptRef,{result,hash});
     return result;
    },{maxAttempts:10});
    assert.equal(response.ok,true);metric.ok=true;
   }catch(error){metric.reason=error.code||error.message;}
   metric.elapsedMs=Math.round(performance.now()-started);
  }));
 }finally{gate.close();}
 const rootAfter=await room.get(),publicAfter=await pub.get();
 assert.equal(publicAfter.updateTime.isEqual(publicBefore.updateTime),true,'scoring must not write public mirror directly in this lab');
 const success=metrics.filter(x=>x.ok).length,retries=metrics.reduce((n,x)=>n+x.attempts-1,0);
 if(mode==='bucket'){
  assert.equal(rootAfter.updateTime.isEqual(rootBefore.updateTime),true,'partitioned score wrote shared room root');
  const buckets=await Promise.all(Array.from({length:m.bucketCount},(_,i)=>room.collection('scoreBuckets').doc('court-'+(i+1)).get()));
  const projected=B.compose(base,m,buckets.map(s=>s.data()));
  for(let i=0;i<count;i++){
   const entry=projected.matches[i],ok=metrics.find(x=>x.station===i+1).ok;
   assert.equal(entry.scoreA,ok?1:0,'acknowledged score missing or failed score leaked');
   assert.equal(entry.scoreB,0);
   const receipt=await room.collection('scoreBuckets').doc(B.route(m,i+1).id).collection('operations').doc(B.operationKey('lab-ref'+(i+1),'lab-operation-'+round+'-'+String(i+1).padStart(3,'0'))).get();
   assert.equal(receipt.exists,ok,'receipt must match persisted score');
  }
  assert.equal(success,count,'four-court candidate should accept all independent court writes');
  const firstReceipt=room.collection('scoreBuckets').doc('court-1').collection('operations').doc(B.operationKey('lab-ref1','lab-operation-'+round+'-001'));
  const firstBucket=room.collection('scoreBuckets').doc('court-1'),unchanged=await firstBucket.get();
  const replay=await db.runTransaction(async tx=>{
   const [bucket,receipt]=await Promise.all([tx.get(firstBucket),tx.get(firstReceipt)]);
   assert(bucket.exists&&receipt.exists);
   const original={station:1,matchId:'m1',operationId:'lab-operation-'+round+'-001',uid:'lab-ref1'};
   const hash=crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex');
   if(receipt.data().hash!==hash)throw Error('operation-conflict');
   return receipt.data().result;
  });
  assert.equal(replay.scoreA,1,'lost-reply replay must return the recorded operation');
  assert.equal((await firstBucket.get()).updateTime.isEqual(unchanged.updateTime),true,'replay must not write again');
 }else{
  const scores=rootAfter.data().scores;
  for(let i=0;i<count;i++)assert.equal(scores['m'+(i+1)],metrics.find(x=>x.station===i+1).ok?1:0);
 }
 const report={courts:count,buckets:m.bucketCount,mode,round,success,failures:count-success,retries,metrics};results.cases.push(report);
 console.log(JSON.stringify({courts:count,buckets:m.bucketCount,mode,round,success,failures:count-success,retries}));
}
(async()=>{
 const deadline=setTimeout(()=>{console.error('lab-timeout');process.exit(2);},240000);
 try{
  for(const count of [6,12])for(const round of [1,2])for(const mode of ['shared','bucket'])await run(count,mode,round);
  console.log('PASS isolated four-court bucket candidate; official scoring/confirmation not enabled');
 }catch(e){console.error(e);process.exitCode=1;}
 finally{
  const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2)+'\n');
  clearTimeout(deadline);await deleteApp(app);
 }
})();
