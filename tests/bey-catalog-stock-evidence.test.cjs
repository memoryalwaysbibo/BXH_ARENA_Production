'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOriginalAssemblyCandidates,approveOriginalAssemblyCandidate}=require('../modules/bey-catalog/stock-evidence-candidates.cjs');
function fixture(){
 return {sources:[{sourceId:'official',url:'https://example.org/official',authority:'manufacturer'},{sourceId:'supplier',url:'https://example.org/supplier',authority:'retailer'}],
 products:[{productId:'p',productCode:'UX-TEST'}],
 parts:[{partId:'blade',category:'blade'},{partId:'ratchet',category:'ratchet'},{partId:'bit',category:'bit'},{partId:'chip',category:'lock_chip'}],
 assemblyClaims:[
  {groupId:'official-group',productId:'p',displayName:'Stock configuration',structure:'一般三件式',verificationStatus:'official_direct',evidence:[{sourceId:'official',locator:'original parts list'}]},
  {groupId:'supplier-group',productId:'p',displayName:'Supplier combination',structure:'一般三件式',verificationStatus:'supplier_pending',evidence:[{sourceId:'supplier',locator:'supplier list'}]},
  {groupId:'part-group',productId:'p',displayName:'Single component',structure:'單一拆件',verificationStatus:'official_direct',evidence:[{sourceId:'official',locator:'part page'}]}
 ],
 contentClaims:[
  ...['official-group','supplier-group'].flatMap(groupId=>['blade','ratchet','bit'].map(partId=>({groupId,partId}))),
  {groupId:'part-group',partId:'chip'}
 ]};
}
test('exact stock original becomes review candidate, not auto-published',()=>{
 const rows=createOriginalAssemblyCandidates(fixture());
 assert.equal(rows[0].status,'ready_for_human_review');
 assert.equal(rows[0].scope,'exact_stock_configuration_only');
 assert.equal(rows[0].canAutoPublish,false);
 assert.equal(rows[0].canAutoMarkSelectable,false);
 assert.equal(rows[0].canAutoInferCrossCompatibility,false);
});
test('retailer-only composition remains pending',()=>{
 const rows=createOriginalAssemblyCandidates(fixture());
 assert.equal(rows[1].status,'source_recheck_required');
 assert.throws(()=>approveOriginalAssemblyCandidate(rows[1],{reviewerId:'admin',reviewedAt:'2026-10-09T02:00:00Z',sourceRechecked:true}),/CANDIDATE_NOT_READY/);
});
test('single loose component cannot be approved as assembled Beyblade',()=>{
 const rows=createOriginalAssemblyCandidates(fixture());
 assert.equal(rows[2].status,'not_full_assembly');
 assert.throws(()=>approveOriginalAssemblyCandidate(rows[2],{reviewerId:'admin',reviewedAt:'2026-10-09T02:00:00Z',sourceRechecked:true}),/CANDIDATE_NOT_READY/);
});
test('explicit reviewer confirmation required; approval remains unpublished',()=>{
 const row=createOriginalAssemblyCandidates(fixture())[0];
 assert.throws(()=>approveOriginalAssemblyCandidate(row),/EXPLICIT_REVIEW_REQUIRED/);
 const approved=approveOriginalAssemblyCandidate(row,{reviewerId:'admin_1',reviewedAt:'2026-10-09T02:00:00Z',sourceRechecked:true});
 assert.equal(approved.reviewState,'approved_for_rule_draft');
 assert.equal(approved.publicationStatus,'unpublished');
 assert.equal(approved.selectable,false);
 assert.deepEqual(approved.partIds,['blade','ratchet','bit']);
});
test('missing official URL or provenance cannot pass',()=>{
 const d=fixture();d.sources[0].url='';
 assert.equal(createOriginalAssemblyCandidates(d)[0].status,'source_recheck_required');
});
