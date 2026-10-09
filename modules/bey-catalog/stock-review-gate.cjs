'use strict';
/**
 * DB-02 two-person review PLAN only.
 * Identity strings are assertions, NOT authentication; the future server must
 * derive identity and role from verified tokens and persist audit atomically.
 * This module never publishes a release or makes parts selectable.
 */
const {hash}=require('./assembly-rule-registry.cjs');
const REVIEWER=/^[A-Za-z0-9_-]{2,80}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
function ensure(v,msg){if(!v)throw Error(msg);}
function normalizeDraft(d){
 ensure(d?.reviewStatus==='requires_authorized_source_review'&&d?.evidenceStatus==='pending'&&d?.publicationStatus==='unpublished'&&d?.canAutoPublish===false,'DRAFT_NOT_REVIEWABLE');
 ensure(d.scope==='exact_stock_configuration_only'&&Array.isArray(d.partIds)&&d.partIds.length>=2,'INVALID_DRAFT_SCOPE');
 ensure(Array.isArray(d.sourceRefs)&&d.sourceRefs.some(s=>s.authority==='manufacturer'&&s.url?.startsWith('https://')&&s.locator),'OFFICIAL_SOURCE_REQUIRED');
 ensure(typeof d.draftId==='string'&&d.draftId.startsWith('draft_'),'INVALID_DRAFT_ID');
 return {draftId:d.draftId,partIds:[...d.partIds].sort(),sourceRefs:d.sourceRefs.map(s=>({sourceId:s.sourceId,url:s.url,locator:s.locator,authority:s.authority})),scope:d.scope};
}
function proposeEvidenceReview(draft,{reviewerId,reviewedAt,sourceRechecked,decision,notes}={}){
 const snapshot=normalizeDraft(draft);
 ensure(REVIEWER.test(reviewerId||'')&&UTC.test(reviewedAt||'')&&sourceRechecked===true,'REVIEW_ATTESTATION_REQUIRED');
 ensure(['accept','reject'].includes(decision)&&typeof notes==='string'&&notes.trim().length>=12,'REVIEW_DECISION_REQUIRED');
 return Object.freeze({draftId:draft.draftId,draftHash:hash(snapshot),stage:'reviewed',reviewerId,reviewedAt,decision,notes:notes.trim(),publicationStatus:'unpublished',selectable:false});
}
function proposeSecondApproval(draft,first,{approverId,approvedAt,decision,notes}={}){
 const snapshot=normalizeDraft(draft);
 ensure(first?.stage==='reviewed'&&first.draftId===draft.draftId&&first.draftHash===hash(snapshot),'STALE_REVIEW');
 ensure(first.decision==='accept','FIRST_REVIEW_NOT_ACCEPTED');
 ensure(REVIEWER.test(approverId||'')&&UTC.test(approvedAt||'')&&approverId!==first.reviewerId,'INDEPENDENT_APPROVER_REQUIRED');
 ensure(['approve','reject'].includes(decision)&&typeof notes==='string'&&notes.trim().length>=12,'APPROVAL_DECISION_REQUIRED');
 return Object.freeze({draftId:draft.draftId,draftHash:first.draftHash,stage:decision==='approve'?'ready_for_server_verification':'rejected',firstReviewer:first.reviewerId,approverId,approvedAt,notes:notes.trim(),publicationStatus:'unpublished',selectable:false,canPublish:false,requiresServerAuthorization:true});
}
function publicationGate(review){
 ensure(review?.stage==='ready_for_server_verification','REVIEW_NOT_APPROVED');
 return Object.freeze({eligibleForBackendVerification:true,canPublish:false,reason:'SERVER_AUTH_AND_PERSISTENCE_REQUIRED',draftId:review.draftId});
}
module.exports={normalizeDraft,proposeEvidenceReview,proposeSecondApproval,publicationGate};
