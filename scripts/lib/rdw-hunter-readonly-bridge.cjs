'use strict';
// RDW P3-14: read-only bridge to the audited Hunter 2.1 server evaluator.
// The caller MUST inject createReader from the verified deployed source bundle.
// No writes to users/{uid}/hunterLicense/highest or hunterLicenseAwards.
const {verifiedCurrentTier}=require('./rdw-current-tier-source.cjs');
const VERSION='hunter-license-v2.1';
function createReadOnlyTierResolver({db,createReader,clock}){
 if(!db||typeof db.runTransaction!=='function'||typeof createReader!=='function'||typeof clock!=='function')throw Error('trusted-reader-dependencies-required');
 const evaluate=createReader({db});
 if(typeof evaluate!=='function')throw Error('trusted-reader-invalid');
 return async function resolve(uid){
  if(typeof uid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(uid))throw Error('invalid-uid');
  return db.runTransaction(async tx=>{
   const userSnap=await tx.get(db.doc('users/'+uid));
   const user=userSnap.exists?userSnap.data():null;
   if(!user||user.active!==true||user.isTestAccount===true||user.role==='tester')return {ok:false,reason:'account-not-eligible'};
   const evidence=await evaluate({tx,uid});
   if(!evidence||evidence.uid!==uid||evidence.version!==VERSION||evidence.complete!==true||evidence.unresolvedIdentities!==0)return {ok:false,reason:'incomplete-server-history'};
   const grade=evidence.overview?.grade;
   const atMs=clock();
   const checked=verifiedCurrentTier({uid,source:'server',verified:true,version:VERSION,status:'unchanged',computedAt:atMs,current:grade&&{tier:grade.tier}}, {uid,atMs});
   if(!checked.ok)return checked;
   return {...checked,sourceDigest:evidence.sourceDigest||null};
  },{readOnly:true});
 };
}
module.exports={createReadOnlyTierResolver};
