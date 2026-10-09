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
 const canonicalRef=doc(db,'beyCatalogRuleDrafts',draftId);
 const releaseRef=doc(db,'beyCatalogRuleReleases',release.releaseId);
 return runTransaction(db,async tx=>{
  const [reviewSnap,canonicalSnap,existingSnap]=await Promise.all([tx.get(reviewRef),tx.get(canonicalRef),tx.get(releaseRef)]);
  const review=reviewSnap.exists()?reviewSnap.data():null;
  assertReview(review,release);
  const canonical=canonicalSnap.exists()?canonicalSnap.data():null;
  if(!canonical||canonical.publicationStatus!=='unpublished'||canonical.reviewStatus!=='requires_authorized_source_review'||canonical.draftHash!==review.draftHash)throw Error('CANONICAL_REVIEW_MISMATCH');
  const exact=Array.isArray(canonical.partIds)?[...canonical.partIds].sort():[];
  if(exact.length<2||!Array.isArray(release.rules)||release.rules.length!==1||release.rules[0].result!=='compatible'||release.rules[0].partIds.slice().sort().join('|')!==exact.join('|'))throw Error('RELEASE_EXACT_STOCK_SCOPE_REQUIRED');
  if(!Array.isArray(canonical.sourceRefs)||!canonical.sourceRefs.some(s=>s.authority==='manufacturer'&&s.sourceId===release.rules[0].sourceId&&s.url===release.rules[0].sourceUrl))throw Error('RELEASE_SOURCE_NOT_MATCHED');
  if(existingSnap.exists()){
   if(existingSnap.data().checksum!==release.checksum)throw Error('RELEASE_ID_CONFLICT');
   return {status:'unchanged',releaseId:release.releaseId,published:false};
  }
  tx.set(releaseRef,{releaseId:release.releaseId,checksum:release.checksum,createdBy:release.createdBy,createdAt:release.createdAt,rules:release.rules,sourceDraftId:draftId,publicationStatus:'unpublished',active:false,selectable:false,origin:'reviewed_proposal'});
  return {status:'created',releaseId:release.releaseId,published:false};
 },{maxAttempts:5});
}
module.exports={stageReleaseProposal};
