'use strict';
const {randomUUID}=require('node:crypto');
const JOB='teamProjectionControlV1/current',BOARD='hunterLeaderboardMeta/current',SEASON='ladderSystem/current';
const LIMIT=10,LEASE_MS=4*60*1000;
// Internal server worker only. Queue always targets the latest canonical board/season.
function createReconciler({db,documentId,refresh,enabled=()=>false,clock=Date.now,newId=randomUUID}){
 if(!db||!documentId||typeof refresh!=='function')throw Error('reconcile-dependencies-required');
 const ref=p=>db.doc(p),snapshot=async(tx,p)=>{const s=await tx.get(ref(p));return s.exists?s.data():null;};
 async function enqueue(){
  if(!enabled())return {status:'disabled'};
  return db.runTransaction(async tx=>{
   const [job,board,ladder]=await Promise.all([snapshot(tx,JOB),snapshot(tx,BOARD),snapshot(tx,SEASON)]);
   const generation=board?.generation,season=ladder?.currentSeason;
   if(typeof generation!=='string'||!/^g\d{13}-[a-f0-9]{12}$/.test(generation)||typeof season!=='string'||!season)throw Error('sources-unavailable');
   if(job?.generation===generation&&job?.season===season)return {status:'unchanged'};
   const revision=(Number.isSafeInteger(job?.revision)?job.revision:0)+1;
   tx.set(ref(JOB),{revision,generation,season,cursor:null,state:'pending',leaseId:null,leaseUntil:0,updatedAt:clock()});return {status:'queued',revision};
  });
 }
 async function runBatch(){
  if(!enabled())return {status:'disabled'};
  const leaseId=newId();
  const claim=await db.runTransaction(async tx=>{
   const job=await snapshot(tx,JOB),now=clock();
   if(!job||job.state!=='pending')return null;
   if(job.leaseId&&job.leaseUntil>now)return null;
   tx.update(ref(JOB),{leaseId,leaseUntil:now+LEASE_MS});return {revision:job.revision,cursor:job.cursor??null};
  });
  if(!claim)return {status:'idle'};
  try{
   let query=db.collection('teamsV1').orderBy(documentId).limit(LIMIT);if(claim.cursor)query=query.startAfter(claim.cursor);
   const page=await query.get();
   for(const doc of page.docs){
    // Guard long batches and replaced targets; no new refresh when lease no longer valid.
    const current=await ref(JOB).get();const state=current.exists?current.data():null;
    if(!state||state.revision!==claim.revision||state.leaseId!==leaseId||state.leaseUntil<=clock())return {status:'superseded'};
    await refresh(doc.id);
   }
   return await db.runTransaction(async tx=>{
    const job=await snapshot(tx,JOB);
    if(!job||job.revision!==claim.revision||job.leaseId!==leaseId||job.leaseUntil<=clock())return {status:'superseded'};
    const complete=page.docs.length<LIMIT;
    tx.update(ref(JOB),{cursor:page.docs.at(-1)?.id??claim.cursor,state:complete?'done':'pending',leaseId:null,leaseUntil:0,updatedAt:clock()});
    return {status:complete?'done':'more',processed:page.docs.length};
   });
  }catch(error){
   await db.runTransaction(async tx=>{const job=await snapshot(tx,JOB);if(job?.revision===claim.revision&&job?.leaseId===leaseId)tx.update(ref(JOB),{leaseId:null,leaseUntil:0,updatedAt:clock()});});
   throw error;
  }
 }
 return {enqueue,runBatch};
}
module.exports={createReconciler,LIMIT,LEASE_MS};
