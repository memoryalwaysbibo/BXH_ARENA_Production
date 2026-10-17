'use strict';
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {getFirestore,FieldValue,FieldPath}=require('firebase-admin/firestore');
const {stateOf,completion}=require('./hosting-core');
const db=getFirestore();
async function keepAndCount(code){
 return db.runTransaction(async tx=>{
  const ref=db.doc(`tournaments/${code}`),snap=await tx.get(ref);if(!snap.exists)return null;
  const t=snap.data(),s=stateOf(t),uid=t.createdBy;
  if(!uid||typeof uid!=='string'||uid.includes('/'))return null;
  const ledger=db.doc(`hostCompletionLedger/${code}`),stats=db.doc(`hostStats/${uid}`);
  const [profile,prior,publicRoom]=await Promise.all([tx.get(db.doc(`users/${uid}`)),tx.get(ledger),tx.get(db.doc(`publicTournaments/${code}`))]);
  const summary=completion(t,profile.data());
  if(t.eventAuthority==='community'&&s.archiveStatus==='completed'&&t.expiresAt!=null){
   s.expiresAtMs=null;tx.update(ref,{expiresAt:null,data:JSON.stringify(s)});
   if(publicRoom.exists)tx.update(publicRoom.ref,{expiresAt:null});
  }
  if(summary&&!prior.exists){tx.create(ledger,{...summary,ownerUid:uid,eventCode:code,verifiedAt:FieldValue.serverTimestamp()});tx.set(stats,{completedHostedCount:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()},{merge:true});}
  return summary?uid:null;
 });
}
// A persisted outbox decouples count commits from title evaluation retries.
async function run(code,{queue=true}={}){const uid=await keepAndCount(code);if(uid&&queue)await db.doc(`hostAwardQueue/${uid}`).set({updatedAt:FieldValue.serverTimestamp()},{merge:true});return uid;}
exports.preserveCompletedRoomAndCountHost=onDocumentWritten({document:'tournaments/{code}',region:'asia-east1',retry:true},async e=>{if(e.data?.after.exists)await run(e.params.code);});
exports.syncMyHostingProgress=onCall({region:'asia-east1',cors:true,timeoutSeconds:540},async req=>{
 const uid=req.auth?.uid;if(!uid)throw new HttpsError('unauthenticated','auth-required');
 const p=await db.doc(`users/${uid}`).get();if(!p.exists||p.data().active!==true)throw new HttpsError('permission-denied','inactive-account');
 let last=null,count=0;
 do{
  let q=db.collection('tournaments').where('createdBy','==',uid).orderBy(FieldPath.documentId()).limit(100);if(last)q=q.startAfter(last);
  const page=await q.get();
  for(const d of page.docs)if(await run(d.id,{queue:false}))count++;
  last=page.size===100?page.docs.at(-1):null;
 }while(last);
 await db.doc(`hostStats/${uid}`).set({completedHostedCount:count,titleHistoryStartDate:'2026-09-21',updatedAt:FieldValue.serverTimestamp()},{merge:true});
 await db.doc(`hostAwardQueue/${uid}`).set({updatedAt:FieldValue.serverTimestamp(),source:'self_sync'},{merge:true});
 return {ok:true,completedHostedCount:count};
});
// Rebuilds host progress exactly from all valid completed rooms on/after the title-history baseline.
exports.preserveExistingCompletedRooms=onSchedule({schedule:'every 24 hours',timeZone:'Asia/Taipei',region:'asia-east1',timeoutSeconds:540,maxInstances:1},async()=>{
 if(process.env.GCLOUD_PROJECT!=='bxh-arena'&&process.env.GOOGLE_CLOUD_PROJECT!=='bxh-arena')return;
 const counts=new Map(),touched=new Set();let last=null,scanned=0,qualified=0;
 do{
  let q=db.collection('tournaments').orderBy(FieldPath.documentId()).limit(100);if(last)q=q.startAfter(last);
  const page=await q.get();
  for(const d of page.docs){
   scanned++;
   if(stateOf(d.data()).archiveStatus!=='completed')continue;
   const uid=await run(d.id,{queue:false});
   if(uid){qualified++;counts.set(uid,Number(counts.get(uid)||0)+1);touched.add(uid);}
  }
  last=page.size===100?page.docs.at(-1):null;
 }while(last);

 let statsLast=null;
 do{
  let q=db.collection('hostStats').orderBy(FieldPath.documentId()).limit(100);if(statsLast)q=q.startAfter(statsLast);
  const page=await q.get();
  for(const d of page.docs){
   const exact=Number(counts.get(d.id)||0);
   await d.ref.set({completedHostedCount:exact,titleHistoryStartDate:'2026-09-21',updatedAt:FieldValue.serverTimestamp()},{merge:true});
   touched.add(d.id);
  }
  statsLast=page.size===100?page.docs.at(-1):null;
 }while(statsLast);

 for(const [uid,count] of counts){
  await db.doc(`hostStats/${uid}`).set({completedHostedCount:Number(count),titleHistoryStartDate:'2026-09-21',updatedAt:FieldValue.serverTimestamp()},{merge:true});
 }
 for(const uid of touched)await db.doc(`hostAwardQueue/${uid}`).set({updatedAt:FieldValue.serverTimestamp(),source:'history_rebuild'},{merge:true});
 console.log('host-title-history-rebuild',{historyStart:'2026-09-21',scanned,qualified,hosts:counts.size});
});
