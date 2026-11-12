'use strict';
// RDW P3-14: read-only bridge to the audited Hunter 2.1 server evaluator.
// The caller MUST inject createReader from the verified deployed source bundle.
// Caller supplies only a transaction with read permissions; this function never calls write methods.
// Firebase Admin SDK runTransaction is not made read-only by a fictitious {readOnly:true} option.
const {verifiedCurrentTier}=require('./rdw-current-tier-source.cjs');
const VERSION='hunter-license-v2.1';
function createReadOnlyTierResolver({db,createReader,clock}){
 if(!db||typeof db.runTransaction!=='function'||typeof db.doc!=='function'||typeof db.collection!=='function'||typeof createReader!=='function'||typeof clock!=='function')throw Error('trusted-reader-dependencies-required');
 // Current verified backend reader uses only doc(), collection(), and tx.get().
 // Restrict constructor capabilities; do not expose runTransaction(), batch(),
 // bulkWriter() or admin methods. Firestore refs themselves remain powerful,
 // so provenance review / least-privilege IAM are STILL mandatory.
 const readerDb=Object.freeze({
  doc:(path)=>db.doc(path),
  collection:(name)=>db.collection(name)
 });
 const evaluate=createReader({db:readerDb});
 if(typeof evaluate!=='function')throw Error('trusted-reader-invalid');
 return async function resolve(uid){
  if(typeof uid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(uid))throw Error('invalid-uid');
  return db.runTransaction(async tx=>{
   const userSnap=await tx.get(db.doc('users/'+uid));
   const user=userSnap.exists?userSnap.data():null;
   if(!user||user.active!==true||user.isTestAccount===true||user.role==='tester'||user.deleted===true||['deleted','disabled','frozen','pending_family_transfer'].includes(user.accountStatus)||user.familyTransferPending===true)return {ok:false,reason:'account-not-eligible'};
   // Expose only transaction reads to the injected evaluator. A Firestore transaction
   // remains a read/write-capable object; do not hand that object to shadow code.
   // This limits accidental transaction writes, but does not replace server IAM,
   // an audited createReader implementation, or full backend read-only review.
   const readTx=Object.freeze({get:(ref)=>tx.get(ref)});
   const evidence=await evaluate({tx:readTx,uid});
   if(!evidence||evidence.uid!==uid||evidence.version!==VERSION||evidence.complete!==true||evidence.unresolvedIdentities!==0||evidence.sourceScope!=='public-official-canonical-self-history-v1'||!(/^[a-f0-9]{64}$/.test(evidence.sourceDigest||'')))return {ok:false,reason:'incomplete-server-history'};
   const grade=evidence.overview?.grade;
   const atMs=clock();
   const checked=verifiedCurrentTier({uid,source:'server',verified:true,version:VERSION,status:'unchanged',computedAt:atMs,current:grade&&{tier:grade.tier}}, {uid,atMs});
   if(!checked.ok)return checked;
   return {...checked,source:'server',verified:true,status:'unchanged',current:{tier:checked.tier},complete:true,unresolvedIdentities:0,sourceDigest:evidence.sourceDigest,sourceScope:evidence.sourceScope};
  });
 };
}
module.exports={createReadOnlyTierResolver};
