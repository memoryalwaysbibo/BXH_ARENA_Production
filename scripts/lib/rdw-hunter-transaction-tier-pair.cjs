'use strict';
// Isolated Hunter 2.1 evidence adapter for RDW snapshot transaction.
// Uses one caller-owned Firestore transaction; never grants awards or starts a match.
// The createReader implementation must come from independently audited private
// backend source; this module MUST NOT enable production writes by itself.
const {verifiedCurrentTier}=require('./rdw-current-tier-source.cjs');
const VERSION='hunter-license-v2.1';
const SCOPE='public-official-canonical-self-history-v1';
const UID=/^[A-Za-z0-9_-]{1,128}$/;
function createTransactionTierResolver({db,createReader}={}){
 if(typeof db?.doc!=='function'||typeof db?.collection!=='function'||typeof createReader!=='function')
  throw Error('trusted-reader-dependencies-required');
 const readerDb=Object.freeze({doc:path=>db.doc(path),collection:name=>db.collection(name)});
 const evaluate=createReader({db:readerDb});
 if(typeof evaluate!=='function')throw Error('trusted-reader-invalid');
 async function one(tx,uid,atMs){
  const userDoc=await tx.get(db.doc('users/'+uid));
  const user=userDoc.exists?userDoc.data():null;
  if(!user||user.active!==true||user.deleted===true||user.isTestAccount===true||
     user.role==='tester'||user.familyTransferPending===true||
     ['deleted','disabled','frozen','pending_family_transfer'].includes(user.accountStatus))
   return {ok:false,reason:'account-not-eligible'};
  const evidence=await evaluate({tx,uid});
  if(!evidence||evidence.uid!==uid||evidence.version!==VERSION||
     evidence.complete!==true||evidence.unresolvedIdentities!==0||
     evidence.sourceScope!==SCOPE||!/^[a-f0-9]{64}$/.test(evidence.sourceDigest||''))
   return {ok:false,reason:'incomplete-server-history'};
  const tier=evidence.overview?.grade?.tier;
  const verified=verifiedCurrentTier({
   uid,version:VERSION,source:'server',verified:true,status:'unchanged',
   computedAt:atMs,current:{tier}
  },{uid,atMs});
  if(!verified.ok)return verified;
  return {...verified,source:'server',verified:true,complete:true,unresolvedIdentities:0,
   status:'unchanged',current:{tier:verified.tier},sourceScope:SCOPE,sourceDigest:evidence.sourceDigest};
 }
 return async function resolvePair({tx,playerA,playerB,atMs}={}){
  if(typeof tx?.get!=='function'||!Object.isFrozen(tx)||
     typeof playerA!=='string'||!UID.test(playerA)||
     typeof playerB!=='string'||!UID.test(playerB)||playerA===playerB||
     !Number.isSafeInteger(atMs)||atMs<=0)throw Error('trusted-pair-context-required');
  // Read first player's evidence before the second, so no write occurs during
  // a partly resolved pair. The enclosing snapshot transaction owns the commit.
  const a=await one(tx,playerA,atMs);
  if(!a.ok)return {a,b:{ok:false,reason:'pair-failed-closed'}};
  const b=await one(tx,playerB,atMs);
  return {a,b};
 };
}
module.exports={createTransactionTierResolver};
