'use strict';
/**
 * Emulator-only review persistence. The caller's uid comes from verifyIdToken,
 * and the role comes from a Firestore users document read inside a transaction.
 * This is not a production endpoint and must not be deployed as one.
 */
const {doc,runTransaction}=require('firebase/firestore');
const {verifyEmulator}=require('./catalog-emulator-transactions.cjs');
const {normalizeDraft}=require('./stock-review-gate.cjs');
const {hash}=require('./assembly-rule-registry.cjs');
const ID=/^[A-Za-z0-9_-]{2,80}$/;
function requireReviewInput(action,notes,sourceRechecked){
 if(!['accept','reject','approve'].includes(action)||typeof notes!=='string'||notes.trim().length<12)throw Error('REVIEW_REASON_REQUIRED');
 if(sourceRechecked!==true)throw Error('SOURCE_RECHECK_REQUIRED');
}
function assertTrustedVerifier(authVerifier){
 if(!authVerifier||typeof authVerifier.verifyIdToken!=='function')throw Error('TOKEN_VERIFIER_REQUIRED');
}
async function persistReview({db,target,authVerifier,idToken,draft,action,notes,sourceRechecked}={}){
 verifyEmulator(db,target);
 assertTrustedVerifier(authVerifier);
 requireReviewInput(action,notes,sourceRechecked);
 const snapshot=normalizeDraft(draft);
 if(!ID.test(snapshot.draftId))throw Error('INVALID_DRAFT_ID');
 const verified=await authVerifier.verifyIdToken(idToken,true);
 const uid=verified?.uid;
 if(!ID.test(uid||'')||verified.firebase?.sign_in_provider==='anonymous')throw Error('VERIFIED_USER_REQUIRED');
 const digest=hash(snapshot);
 const ref=doc(db,'beyCatalogReviewDrafts',snapshot.draftId);
 const userRef=doc(db,'users',uid);
 const canonicalRef=doc(db,'beyCatalogRuleDrafts',snapshot.draftId);
 return runTransaction(db,async tx=>{
  const [profile,canonical,existing]=await Promise.all([tx.get(userRef),tx.get(canonicalRef),tx.get(ref)]);
  if(!canonical.exists()||canonical.data().draftHash!==digest||canonical.data().publicationStatus!=='unpublished'||canonical.data().reviewStatus!=='requires_authorized_source_review')throw Error('CANONICAL_DRAFT_MISMATCH');
  const user=profile.exists()?profile.data():null;
  if(!user||user.active!==true||user.isTestAccount===true||!['admin','super_admin'].includes(user.role))throw Error('ADMIN_ROLE_REQUIRED');
  const prior=existing.exists()?existing.data():null;
  if(prior&&prior.draftHash!==digest)throw Error('DRAFT_CHANGED_NEW_REVIEW_REQUIRED');
  if(!prior){
   if(!['accept','reject'].includes(action))throw Error('FIRST_REVIEW_REQUIRED');
   const phase=action==='accept'?'awaiting_second':'rejected';
   const next={draftHash:digest,phase,firstReviewerUid:uid,secondReviewerUid:null,sourceRechecked:true,publicationStatus:'unpublished',selectable:false,reviewLog:[{uid,action,notes:notes.trim()}]};
   tx.set(ref,next);
   return {phase,uid,publicationStatus:'unpublished',selectable:false};
  }
  if(prior.phase!=='awaiting_second')throw Error('REVIEW_ALREADY_FINALIZED');
  if(prior.firstReviewerUid===uid)throw Error('INDEPENDENT_REVIEWER_REQUIRED');
  if(!['approve','reject'].includes(action))throw Error('SECOND_REVIEW_DECISION_REQUIRED');
  const phase=action==='approve'?'ready_for_server_verification':'rejected';
  tx.update(ref,{phase,secondReviewerUid:uid,reviewLog:[...prior.reviewLog,{uid,action,notes:notes.trim()}]});
  return {phase,uid,publicationStatus:'unpublished',selectable:false};
 },{maxAttempts:5});
}
module.exports={persistReview};
