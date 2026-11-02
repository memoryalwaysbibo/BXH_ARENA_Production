'use strict';
const B=require('./bucket-state.cjs'),S=require('./scoring-core.cjs');
// Internal projection worker candidate; emulator-only and never a public callable.
function createBucketPublicProjection(db,{clock=Date.now}={}){
 if(db.projectId!=='demo-bxh-four-court-buckets'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188')throw Error('emulator-only');
 return async (code,{automatic=false,expectedEpoch=null}={})=>{
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-request');
  const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
  return db.runTransaction(async tx=>{
   const [roomSnap,config]=await tx.getAll(root,db.doc('systemConfig/fourCourtScoreBuckets'));
   if(config.data()?.enabled!==true)throw Error('release-not-ready');
   if(automatic&&config.data()?.automaticPublicProjectionEnabled!==true)return {ok:true,skipped:true,reason:'automatic-projection-disabled'};
   if(!roomSnap.exists)throw Error('not-found');
   let base;try{base=JSON.parse(roomSnap.data().data);}catch{throw Error('corrupt-data');}
   const m=B.context(roomSnap.data(),base);if(m.code!==code)throw Error('room-mismatch');
   if(expectedEpoch!==null&&expectedEpoch!==m.epoch)return {ok:true,skipped:true,reason:'epoch-mismatch'};
   const snaps=await tx.getAll(...Array.from({length:m.bucketCount},(_,i)=>root.collection('matchBuckets').doc('court-'+(i+1))));
   const buckets=snaps.map(s=>s.exists?s.data():null),state=B.materialize(base,m,buckets);
   // Match the structural scorer's lock order: room, buckets, then public view.
   const pubSnap=await tx.get(pub);if(!pubSnap.exists)throw Error('not-found');
   let previous;try{previous=JSON.parse(pubSnap.data().bracketView);}catch{throw Error('corrupt-data');}
   const versions=Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision])),projection={epoch:m.epoch,versions};
   const previousVector=pubSnap.data().scoreBucketProjection;
   if(previousVector?.epoch===m.epoch&&Object.keys(previousVector.versions||{}).length===buckets.length&&buckets.every(b=>previousVector.versions[b.bucketId]===b.revision))return {ok:true,skipped:true,projection};
   state.updatedAt=Math.max(clock(),Number(pubSnap.data().updatedAt||0)+1);
   tx.update(pub,{bracketView:JSON.stringify(S.publicProjection(state,previous)),scoreBucketProjection:projection,updatedAt:state.updatedAt});
   return {ok:true,skipped:false,projection};
  });
 };
}
module.exports={createBucketPublicProjection};
