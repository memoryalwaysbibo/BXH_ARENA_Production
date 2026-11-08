'use strict';
const A=require('./certificate.cjs');
const POLICY=['testMode','eventAuthority','createdByRole','systemClosed','eventCancelled','tournamentPhase','createdBy','ownerUid','completedAt','ladderAwardedAt','archiveStatus'];
function parse(top){try{const state=typeof top.data==='string'?JSON.parse(top.data):top.data;return state&&typeof state==='object'&&!Array.isArray(state)?state:null;}catch{return null;}}
function fenced(...docs){return docs.some(d=>['bucketMigration','deletionStatus'].some(k=>A.has(d,k)));}
async function current({db,tx,code,sourceSnapshot=null}){
 const [root,pub]=await Promise.all([tx.get(db.doc('tournaments/'+code)),tx.get(db.doc('publicTournaments/'+code))]);
 if(!root.exists)return null;
 const sourceCreatedAt=A.identity(root);
 if(sourceSnapshot&&(!sourceSnapshot.exists||A.identity(sourceSnapshot)!==sourceCreatedAt))return null;
 let top=root.data(),state=parse(top);if(!state||fenced(top,pub.data()))return null;
 if(A.has(top,'scoreBucketProjection')||A.has(pub.data(),'scoreStorage'))return null;
 let bucketEpoch=null;
 if(A.marked(top,pub.data())){
  // A finished bucket room must have a matching private/public certificate and
  // the exact authoritative bucket vector. Legacy JSON alone cannot award it.
  const input=await A.load({db,tx,root,pub});A.completed(input,{required:true});
  top={...input.top,data:JSON.stringify(input.state)};state=input.state;bucketEpoch=input.m.epoch;
 }
 if(state.archiveStatus!=='completed')return null;
 const policy=Object.fromEntries(POLICY.filter(k=>A.has(top,k)).map(k=>[k,top[k]]));
 const completionDigest=A.digest({policy,state});
 const receipt={roomSourceCreatedAt:sourceCreatedAt,bucketEpoch,completionDigest};
 return {top,guard:{code,sourceCreatedAt,publicCreatedAt:pub.exists?A.identity(pub):null,completionDigest,receipt}};
}
async function safeCurrent(args){try{return await current(args);}catch(e){if(e.completionCode)return null;throw e;}}
async function capture({db,code,sourceSnapshot=null}){
 if(typeof code!=='string'||!code||code.includes('/'))return null;
 // Triggers must pass their SDK snapshot; callers which intentionally scan
 // current rooms can omit it, but still get a fresh, physically bound source.
 return db.runTransaction(tx=>safeCurrent({db,tx,code,sourceSnapshot}));
}
async function authorize({db,tx,guard,uid,active}){
 const input=await safeCurrent({db,tx,code:guard.code});
 if(!input||input.guard.sourceCreatedAt!==guard.sourceCreatedAt||input.guard.publicCreatedAt!==guard.publicCreatedAt||!A.equal(input.guard.receipt,guard.receipt))return false;
 const profile=await tx.get(db.doc('users/'+uid));
 return !!active(profile.data());
}
function existingReceipt(previous,guard){
 const receipt=previous?.metadata;
 // Keep old code-keyed permanent grants. Never invent a parent identity for a
 // pre-patch receipt, or treat another incarnation's ledger as a fresh award.
 if(!receipt||!A.has(receipt,'roomSourceCreatedAt'))return {legacyReceipt:true};
 if(Object.entries(guard.receipt).some(([k,v])=>receipt[k]!==v))return {requiresReview:true};
 return {};
}
module.exports={capture,authorize,existingReceipt};
