'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {proposeEvidenceReview,proposeSecondApproval,publicationGate}=require('../modules/bey-catalog/stock-review-gate.cjs');
const draft={draftId:'draft_abcdef',reviewStatus:'requires_authorized_source_review',evidenceStatus:'pending',publicationStatus:'unpublished',canAutoPublish:false,scope:'exact_stock_configuration_only',partIds:['b','r','t'],sourceRefs:[{sourceId:'tt',authority:'manufacturer',url:'https://example.org/original',locator:'box content'}]};
const firstInput={reviewerId:'reviewer_a',reviewedAt:'2026-10-09T02:00:00Z',sourceRechecked:true,decision:'accept',notes:'Manufacturer original combination confirmed'};
const secondInput={approverId:'reviewer_b',approvedAt:'2026-10-09T02:30:00Z',decision:'approve',notes:'Independent second evidence verification'};
test('independent two-person review is a plan, never publication',()=>{
 const first=proposeEvidenceReview(draft,firstInput),second=proposeSecondApproval(draft,first,secondInput);
 assert.equal(first.publicationStatus,'unpublished');
 assert.equal(second.stage,'ready_for_server_verification');
 assert.equal(second.canPublish,false);
 assert.equal(second.selectable,false);
 assert.equal(publicationGate(second).canPublish,false);
});
test('same person cannot self-approve',()=>{
 const first=proposeEvidenceReview(draft,firstInput);
 assert.throws(()=>proposeSecondApproval(draft,first,{...secondInput,approverId:'reviewer_a'}),/INDEPENDENT_APPROVER_REQUIRED/);
});
test('unreviewed source or short rationale cannot be approved',()=>{
 assert.throws(()=>proposeEvidenceReview(draft,{...firstInput,sourceRechecked:false}),/REVIEW_ATTESTATION_REQUIRED/);
 assert.throws(()=>proposeEvidenceReview(draft,{...firstInput,notes:'ok'}),/REVIEW_DECISION_REQUIRED/);
});
test('reject first review cannot pass second approval',()=>{
 const first=proposeEvidenceReview(draft,{...firstInput,decision:'reject'});
 assert.throws(()=>proposeSecondApproval(draft,first,secondInput),/FIRST_REVIEW_NOT_ACCEPTED/);
});
test('tampering with draft invalidates prior review',()=>{
 const first=proposeEvidenceReview(draft,firstInput);
 assert.throws(()=>proposeSecondApproval({...draft,partIds:['b','r','different']},first,secondInput),/STALE_REVIEW/);
});
test('retailer-only evidence or published draft cannot enter review',()=>{
 assert.throws(()=>proposeEvidenceReview({...draft,sourceRefs:[{sourceId:'s',authority:'retailer',url:'https://example.org',locator:'listing'}]},firstInput),/OFFICIAL_SOURCE_REQUIRED/);
 assert.throws(()=>proposeEvidenceReview({...draft,publicationStatus:'published'},firstInput),/DRAFT_NOT_REVIEWABLE/);
});
test('rejected second review cannot pass publication gate',()=>{
 const first=proposeEvidenceReview(draft,firstInput);
 const second=proposeSecondApproval(draft,first,{...secondInput,decision:'reject'});
 assert.throws(()=>publicationGate(second),/REVIEW_NOT_APPROVED/);
});
