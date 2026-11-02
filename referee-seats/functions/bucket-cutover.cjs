'use strict';
const {randomUUID}=require('node:crypto');
const {FieldValue}=require('firebase-admin/firestore');
const B=require('./bucket-state.cjs'),S=require('./scoring-core.cjs');

// Internal Emulator-only migration experiment. No Firebase callable or trigger exports it.
function createBucketCutover(db,{clock=Date.now}={}){
 if(db.projectId!=='demo-bxh-four-court-buckets'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188')throw Error('emulator-only');
 function refs(code){
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-request');
  return {root:db.doc('tournaments/'+code),pub:db.doc('publicTournaments/'+code),config:db.doc('systemConfig/fourCourtScoreBuckets')};
 }
 function parse(value){try{return JSON.parse(value);}catch{throw Error('corrupt-data');}}
 function validated(rootSnap,pubSnap,config){
  if(config.data()?.enabled!==true)throw Error('release-not-ready');
  if(!rootSnap.exists||!pubSnap.exists)throw Error('not-found');
  const room=rootSnap.data(),state=parse(room.data),previous=parse(pubSnap.data().bracketView);
  if(!state||!Array.isArray(state.matches)||!Number.isSafeInteger(state.meta?.stations)||state.meta.stations<1||typeof state.id!=='string'||!state.id)throw Error('invalid-room');
  return {room,state,previous};
 }
 function bucketRefs(root,count){return Array.from({length:count},(_,i)=>root.collection('matchBuckets').doc('court-'+(i+1)));}
 async function activate(code,{expectedUpdateTime,epoch=randomUUID()}={}){
  if(!expectedUpdateTime?.isEqual||typeof epoch!=='string'||!epoch||epoch.length>100)throw Error('invalid-cutover-request');
  const {root,pub,config}=refs(code);
  return db.runTransaction(async tx=>{
   const [roomSnap,pubSnap,release]=await tx.getAll(root,pub,config);
   const {room,state,previous}=validated(roomSnap,pubSnap,release);
   if(!roomSnap.updateTime.isEqual(expectedUpdateTime))throw Error('room-changed');
   if(Object.prototype.hasOwnProperty.call(room,'scoreStorage'))throw Error('already-bucketed');
   if(state.cloudCode!==code)throw Error('room-mismatch');
   const manifest=B.makeManifest(state,epoch),buckets=B.encode(state,manifest),refsForBuckets=bucketRefs(root,manifest.bucketCount);
   const existing=await tx.getAll(...refsForBuckets);
   if(existing.some(s=>s.exists))throw Error('partial-bucket-set');
   const now=Math.max(clock(),Number(room.updatedAt||0)+1,Number(pubSnap.data().updatedAt||0)+1);
   state.updatedAt=now;
   for(let i=0;i<buckets.length;i++)tx.create(refsForBuckets[i],buckets[i]);
   tx.update(root,{scoreStorage:manifest,updatedAt:now});
   tx.update(pub,{bracketView:JSON.stringify(S.publicProjection(state,previous)),scoreBucketProjection:{epoch,versions:Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]))},updatedAt:now});
   return {ok:true,epoch,buckets:buckets.length};
  });
 }
 async function rollback(code,{expectedEpoch}={}){
  if(typeof expectedEpoch!=='string'||!expectedEpoch)throw Error('invalid-cutover-request');
  const {root,pub,config}=refs(code);
  return db.runTransaction(async tx=>{
   const [roomSnap,release]=await tx.getAll(root,config);
   if(release.data()?.enabled!==true)throw Error('release-not-ready');
   if(!roomSnap.exists)throw Error('not-found');
   const room=roomSnap.data(),base=parse(room.data),m=B.context(room,base);
   if(m.code!==code||m.epoch!==expectedEpoch)throw Error('epoch-mismatch');
   const refsForBuckets=bucketRefs(root,m.bucketCount),snaps=await tx.getAll(...refsForBuckets);
   const state=B.materialize(base,m,snaps.map(s=>s.exists?s.data():null));
   const pubSnap=await tx.get(pub);if(!pubSnap.exists)throw Error('not-found');
   const previous=parse(pubSnap.data().bracketView);
   const now=Math.max(clock(),Number(room.updatedAt||0)+1,Number(pubSnap.data().updatedAt||0)+1);
   state.updatedAt=now;
   tx.update(root,{scoreStorage:FieldValue.delete(),data:JSON.stringify(state),updatedAt:now});
   tx.update(pub,{scoreBucketProjection:FieldValue.delete(),bracketView:JSON.stringify(S.publicProjection(state,previous)),updatedAt:now});
   for(const bucketRef of refsForBuckets)tx.delete(bucketRef);
   return {ok:true,epoch:expectedEpoch,buckets:refsForBuckets.length};
  });
 }
 return {activate,rollback};
}
module.exports={createBucketCutover};
