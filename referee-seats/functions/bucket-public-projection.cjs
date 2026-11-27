'use strict';
const B=require('./bucket-state.cjs'),S=require('./scoring-core.cjs');
// Internal projection worker; production access also requires a room/epoch gate.
function createBucketPublicProjection(db,{clock=Date.now,runtime='emulator'}={}){
 const gate=require('./bucket-runtime.cjs').createBucketRuntime(db,{runtime});
 return async (code,{automatic=false,expectedEpoch=null}={})=>{
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-request');
  const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
  // Snapshot reads do not lock score buckets. Serialize outside the write transaction.
  const captured=await db.runTransaction(async tx=>{
   const [roomSnap,config]=await tx.getAll(root,db.doc('systemConfig/fourCourtScoreBuckets'));
   if(config.data()?.enabled!==true)throw Error('release-not-ready');
   if(automatic&&config.data()?.automaticPublicProjectionEnabled!==true)return {ok:true,skipped:true,reason:'automatic-projection-disabled'};
   if(!roomSnap.exists)throw Error('not-found');
   let base;try{base=JSON.parse(roomSnap.data().data);}catch{throw Error('corrupt-data');}
   const m=B.context(roomSnap.data(),base);if(m.code!==code)throw Error('room-mismatch');
   gate.assertRoom(config.data(),m);
   if(expectedEpoch!==null&&expectedEpoch!==m.epoch)return {ok:true,skipped:true,reason:'epoch-mismatch'};
   const snaps=await tx.getAll(...Array.from({length:m.bucketCount},(_,i)=>root.collection('matchBuckets').doc('court-'+(i+1))));
   const buckets=snaps.map(s=>s.exists?s.data():null),state=B.materialize(base,m,buckets);
   const pubSnap=await tx.get(pub);if(!pubSnap.exists)throw Error('not-found');
   let previous;try{previous=JSON.parse(pubSnap.data().bracketView);}catch{throw Error('corrupt-data');}
   const versions=Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision])),projection={epoch:m.epoch,versions};
   return {roomSnap,pubSnap,m,projection,mirror:S.publicProjection(state,previous)};
  },{readOnly:true});
  if(captured.ok)return captured;
  return db.runTransaction(async tx=>{
   // Only structural authority, rollout configuration and public output are locked.
   const [roomSnap,config,pubSnap]=await tx.getAll(root,db.doc('systemConfig/fourCourtScoreBuckets'),pub);
   if(config.data()?.enabled!==true)throw Error('release-not-ready');
   if(automatic&&config.data()?.automaticPublicProjectionEnabled!==true)return {ok:true,skipped:true,reason:'automatic-projection-disabled'};
   if(!roomSnap.exists||!pubSnap.exists)throw Error('not-found');
   if(!roomSnap.updateTime?.isEqual(captured.roomSnap.updateTime))throw Error('projection-source-changed');
   gate.assertRoom(config.data(),captured.m);
   const {projection,m}=captured,previousVector=pubSnap.data().scoreBucketProjection;
   if(previousVector?.epoch===m.epoch){
    const versions=previousVector.versions||{},ids=Object.keys(projection.versions);
    if(Object.keys(versions).length!==ids.length||ids.some(id=>!Number.isSafeInteger(versions[id])||versions[id]<0))throw Error('bucket-context');
    if(ids.some(id=>versions[id]>projection.versions[id]))return {ok:true,skipped:true,reason:'newer-projection',projection:previousVector};
    if(ids.every(id=>versions[id]===projection.versions[id]))return {ok:true,skipped:true,projection};
   }
   // Preserve unrelated public updates instead of publishing a stale mirror base.
   if(!pubSnap.updateTime?.isEqual(captured.pubSnap.updateTime))throw Error('projection-source-changed');
   const updatedAt=Math.max(clock(),Number(pubSnap.data().updatedAt||0)+1);
   tx.update(pub,{bracketView:JSON.stringify({...captured.mirror,updatedAt}),scoreBucketProjection:projection,updatedAt});
   return {ok:true,skipped:false,projection};
  });
 };
}
module.exports={createBucketPublicProjection};

