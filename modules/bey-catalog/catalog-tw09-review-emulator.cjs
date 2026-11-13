'use strict';
/**
 * TW-09 isolated Firestore Emulator review journal.
 * The injected verifier MUST be a trusted backend adapter; this is not an HTTP endpoint.
 * Never publishes, alters catalog entities, or writes to production Firestore.
 */
const {doc,runTransaction,serverTimestamp}=require('firebase/firestore');
const {verifyEmulator}=require('./catalog-emulator-transactions.cjs');
const {digest}=require('./catalog-tw06-review.cjs');
const {isActiveCatalogAdmin}=require('./catalog-tw11-role-policy.cjs');
const UID=/^[A-Za-z0-9_-]{2,128}$/;
const PID=/^tw06_[a-f0-9]{28}$/;
function requireReason(decision,notes){
 if(!['accept','approve','reject'].includes(decision)||
    typeof notes!=='string'||notes.trim().length<12||notes.length>1000)throw Error('TW09_DECISION_OR_REASON_INVALID');
}
async function recordTw09Decision({db,target,authVerifier,idToken,proposalId,decision,notes}={}){
 verifyEmulator(db,target);
 if(!authVerifier||typeof authVerifier.verifyIdToken!=='function')throw Error('TW09_TRUSTED_VERIFIER_REQUIRED');
 if(!PID.test(proposalId||''))throw Error('TW09_PROPOSAL_ID_INVALID');
 requireReason(decision,notes);
 if(typeof idToken!=='string'||!idToken)throw Error('TW09_ID_TOKEN_REQUIRED');
 const decoded=await authVerifier.verifyIdToken(idToken,true);
 const uid=decoded?.uid;
 if(!UID.test(uid||'')||decoded.firebase?.sign_in_provider==='anonymous')throw Error('TW09_VERIFIED_USER_REQUIRED');
 const userRef=doc(db,'users',uid);
 const proposalRef=doc(db,'beyCatalogTw09Proposals',proposalId);
 const reviewRef=doc(db,'beyCatalogTw09Reviews',proposalId);
 return runTransaction(db,async tx=>{
  const [userSnap,proposalSnap,reviewSnap]=await Promise.all([
   tx.get(userRef),tx.get(proposalRef),tx.get(reviewRef)
  ]);
  const user=userSnap.exists()?userSnap.data():null;
  if(!isActiveCatalogAdmin(user))throw Error('TW09_ADMIN_REQUIRED');
  const canonical=proposalSnap.exists()?proposalSnap.data():null;
  if(!canonical||canonical.publicationStatus!=='unpublished'||canonical.productionWritable!==false||
    canonical.autoPublish!==false||canonical.batchId!=='DATA-01B-20261009-ZHTW-TW05'||
    !UID.test(canonical.proposerUid||'')||!canonical.proposal||
    canonical.proposal.proposalId!==proposalId||canonical.proposal.proposerId!==canonical.proposerUid||
    canonical.proposal.status!=='pending_first_review'||canonical.proposal.productionWritable!==false||
    canonical.proposal.autoPublish!==false||canonical.proposalHash!==digest(canonical.proposal))
    throw Error('TW09_CANONICAL_PROPOSAL_INVALID');
  if(uid===canonical.proposerUid)throw Error('TW09_SELF_REVIEW_DENIED');
  const prior=reviewSnap.exists()?reviewSnap.data():null;
  if(prior&&prior.proposalHash!==canonical.proposalHash)throw Error('TW09_STALE_PROPOSAL');
  let phase,firstReviewerUid,secondReviewerUid=null,eventStage;
  if(!prior){
   if(!['accept','reject'].includes(decision))throw Error('TW09_FIRST_REVIEW_REQUIRED');
   phase=decision==='accept'?'awaiting_second':'rejected';
   firstReviewerUid=uid;eventStage='first';
  }else{
   if(prior.phase!=='awaiting_second')throw Error('TW09_REVIEW_ALREADY_FINALIZED');
   if(uid===prior.firstReviewerUid)throw Error('TW09_INDEPENDENT_REVIEWER_REQUIRED');
   if(!['approve','reject'].includes(decision))throw Error('TW09_SECOND_REVIEW_REQUIRED');
   const firstRef=doc(db,'users',prior.firstReviewerUid);
   const firstSnap=await tx.get(firstRef);
   const first=firstSnap.exists()?firstSnap.data():null;
   if(!isActiveCatalogAdmin(first))throw Error('TW09_FIRST_REVIEWER_REVOKED');
   phase=decision==='approve'?'approved_for_draft_only':'rejected';
   firstReviewerUid=prior.firstReviewerUid;secondReviewerUid=uid;eventStage='second';
  }
  const eventRef=doc(db,'beyCatalogTw09ReviewEvents',proposalId+'_'+eventStage);
  const eventSnap=await tx.get(eventRef);
  if(eventSnap.exists())throw Error('TW09_DUPLICATE_AUDIT_EVENT');
  tx.set(eventRef,{
   proposalId,proposalHash:canonical.proposalHash,stage:eventStage,actorUid:uid,
   decision,notes:notes.trim(),reviewedAt:serverTimestamp(),publicationStatus:'unpublished',autoPublish:false
  });
  tx.set(reviewRef,{
   proposalId,proposalHash:canonical.proposalHash,phase,firstReviewerUid,secondReviewerUid,
   revision:eventStage==='first'?1:2,updatedAt:serverTimestamp(),
   publicationStatus:'unpublished',productionWritable:false,autoPublish:false,selectable:false
  });
  return {proposalId,phase,stage:eventStage,readOnlyCatalog:true,published:false,
   catalogDocumentsChanged:0,playerRecordsChanged:0};
 },{maxAttempts:5});
}
module.exports={recordTw09Decision};
