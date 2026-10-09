'use strict';
/**
 * DB-02: store immutable UNPUBLISHED release proposals in the local emulator.
 * Does not activate or publish any rule; no production access.
 */
const {doc,runTransaction}=require('firebase/firestore');
const {verifyEmulator}=require('./catalog-emulator-transactions.cjs');
const {createRelease}=require('./assembly-rule-registry.cjs');
const ID=/^[A-Za-z0-9_-]{2,80}$/;
function assertReview(review,release){
 if(!review||review.phase!=='ready_for_server_verification'||review.publicationStatus!=='unpublished'||review.selectable!==false)throw Error('REVIEW_NOT_FINAL');
 if(!ID.test(review.firstReviewerUid||'')||!ID.test(review.secondReviewerUid||'')||review.firstReviewerUid===review.secondReviewerUid)throw Error('TWO_REVIEWERS_REQUIRED');
 if(!Array.isArray(review.reviewLog)||review.reviewLog.length!==2||review.reviewLog[0].uid!==review.firstReviewerUid||review.reviewLog[1].uid!==review.secondReviewerUid)throw Error('REVIEW_LOG_INVALID');
 if(!release?.immutable||!release.checksum)throw Error('RELEASE_NOT_IMMUTABLE');
 const rebuilt=createRelease({releaseId:release.releaseId,createdBy:release.createdBy,createdAt:release.createdAt,rules:release.rules});
 if(rebuilt.checksum!==release.checksum)throw Error('RELEASE_CHECKSUM_MISMATCH');
}
async function stageReleaseProposal({db,target,release,draftId}={}){
 verifyEmulator(db,target);
 if(!ID.test(draftId||''))throw Error('INVALID_DRAFT_ID');
 if(!release?.releaseId||!release?.checksum)throw Error('INVALID_RELEASE');
 const reviewRef=doc(db,'beyCatalogReviewDrafts',draftId);
 const releaseRef=doc(db,'beyCatalogRuleReleases',release.releaseId);
 return runTransaction(db,async tx=>{
  const [reviewSnap,existingSnap]=await Promise.all([tx.get(reviewRef),tx.get(releaseRef)]);
  const review=reviewSnap.exists()?reviewSnap.data():null;
  assertReview(review,release);
  if(existingSnap.exists()){
   if(existingSnap.data().checksum!==release.checksum)throw Error('RELEASE_ID_CONFLICT');
   return {status:'unchanged',releaseId:release.releaseId,published:false};
  }
  tx.set(releaseRef,{releaseId:release.releaseId,checksum:release.checksum,rules:release.rules,sourceDraftId:draftId,publicationStatus:'unpublished',active:false,selectable:false,origin:'reviewed_proposal'});
  return {status:'created',releaseId:release.releaseId,published:false};
 },{maxAttempts:5});
}
module.exports={stageReleaseProposal};
