'use strict';
const A=require('./certificate.cjs');
// Called after legacy code reads the current root, actor, ledger and public peer.
// The caller has performed no writes. All additional reads stay in that transaction.
async function countCertified({db,tx,root,pub,profile,prior,ledger,stats,FieldValue,completion}){
 const input=await A.load({db,tx,root,pub}),done=A.completed(input,{required:true});
 const summary=completion({...input.top,data:JSON.stringify(input.state)},profile.data());
 if(!summary)return null;
 const uid=input.top.createdBy;
 if(prior.exists){const old=prior.data();if(old.ownerUid!==uid||old.sourceCreatedAt!==input.sourceCreatedAt||old.bucketEpoch!==input.m.epoch||old.bucketCompletedAt!==done.receipt.completedAt)A.fail('bucket-host-ledger-requires-review');}
 else{
  tx.create(ledger,{...summary,ownerUid:uid,eventCode:root.id,sourceCreatedAt:input.sourceCreatedAt,bucketEpoch:input.m.epoch,bucketCompletedAt:done.receipt.completedAt,verifiedAt:FieldValue.serverTimestamp()});
  tx.set(stats,{completedHostedCount:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()},{merge:true});
 }
 // Outbox and the first increment commit together. A crash cannot lose title evaluation.
 tx.set(db.doc('hostAwardQueue/'+uid),{updatedAt:FieldValue.serverTimestamp(),source:'certified_bucket_completion'},{merge:true});
 return uid;
}
module.exports={...A,countCertified};

// Each host is rebuilt from a fresh transactional query, never an earlier global
// scan's absolute totals. Read the stats conflict barrier after room/ledger
// validation, immediately before writes: an early stats lock can block a
// certified count's commit while this rebuild waits for that count's ledger.
async function rebuildHost({db,uid,FieldValue,completion,stateOf,requireActiveActor=false}){
 if(typeof uid!=='string'||!uid||uid.includes('/'))A.fail('invalid-host');
 return db.runTransaction(async tx=>{
  const stats=db.doc('hostStats/'+uid),[profile,rooms]=await Promise.all([tx.get(db.doc('users/'+uid)),tx.get(db.collection('tournaments').where('createdBy','==',uid))]);
  if(requireActiveActor&&(!profile.exists||profile.data().active!==true))A.fail('inactive-account');
  if(rooms.size>200)A.fail('bucket-host-rebuild-size-budget');
  let count=0,bytes=0;const creates=[],retention=[];
  for(const listed of rooms.docs){
   const root=await tx.get(listed.ref);if(!root.exists)A.fail('host-room-changed');
   const top=root.data();if(top.createdBy!==uid)A.fail('host-room-changed');
   const [pub,prior]=await Promise.all([tx.get(db.doc('publicTournaments/'+root.id)),tx.get(db.doc('hostCompletionLedger/'+root.id))]);
   bytes+=Buffer.byteLength(JSON.stringify([top,pub.data()]));if(bytes>5000000)A.fail('bucket-host-rebuild-size-budget');
   let state=stateOf(top),binding={};
   if(A.marked(top,pub.data())){
    const input=await A.load({db,tx,root,pub});
    bytes+=Buffer.byteLength(JSON.stringify(input.state));if(bytes>5000000)A.fail('bucket-host-rebuild-size-budget');
    const done=A.completed(input);if(!done)continue;
    state=input.state;binding={sourceCreatedAt:input.sourceCreatedAt,bucketEpoch:input.m.epoch,bucketCompletedAt:done.receipt.completedAt};
    if(prior.exists){const p=prior.data();if(p.ownerUid!==uid||Object.entries(binding).some(([k,v])=>p[k]!==v))A.fail('bucket-host-ledger-requires-review');}
   }
   // Preserve the original unmarked community-room retention repair. Every
   // point read above also lets the captured QR proxy bind this paired write.
   if(!A.marked(top,pub.data())&&top.eventAuthority==='community'&&state.archiveStatus==='completed'&&top.expiresAt!=null){
    state.expiresAtMs=null;retention.push([root.ref,{expiresAt:null,data:JSON.stringify(state)}]);
    if(pub.exists)retention.push([pub.ref,{expiresAt:null}]);
   }
   const summary=completion({...top,data:JSON.stringify(state)},profile.data());if(!summary)continue;
   count++;
   if(!prior.exists)creates.push([db.doc('hostCompletionLedger/'+root.id),{...summary,...binding,ownerUid:uid,eventCode:root.id,verifiedAt:FieldValue.serverTimestamp()}]);
  }
  if(creates.length+retention.length+2>450)A.fail('bucket-host-rebuild-size-budget');
  await tx.get(stats);
  for(const [ref,value]of retention)tx.update(ref,value);
  for(const [ref,value]of creates)tx.create(ref,value);
  tx.set(stats,{completedHostedCount:count,titleHistoryStartDate:'2026-09-21',updatedAt:FieldValue.serverTimestamp()},{merge:true});
  tx.set(db.doc('hostAwardQueue/'+uid),{updatedAt:FieldValue.serverTimestamp(),source:'transactional_history_rebuild'},{merge:true});
  return count;
 });
}
async function rebuildAll(options){
 const {db,FieldPath}=options,uids=new Set();
 for(const name of ['tournaments','hostStats']){
  let last=null;do{
   let q=db.collection(name).orderBy(FieldPath.documentId()).limit(100);if(last)q=q.startAfter(last);
   const page=await q.get();for(const d of page.docs){const uid=name==='tournaments'?d.data().createdBy:d.id;if(typeof uid==='string'&&uid&&!uid.includes('/'))uids.add(uid);}
   last=page.size===100?page.docs.at(-1):null;
  }while(last);
 }
 for(const uid of uids)await rebuildHost({...options,uid});
 return {ok:true,hosts:uids.size};
}
module.exports.rebuildHost=rebuildHost;module.exports.rebuildAll=rebuildAll;
