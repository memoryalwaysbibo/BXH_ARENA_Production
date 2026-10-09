'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {toRuleDraft,compileDrafts,reviewImpact}=require('../modules/bey-catalog/stock-rule-drafts.cjs');
const official={candidateId:'stock_group1',groupId:'group1',productId:'p1',partIds:['blade_1','ratchet_1','bit_1'],status:'ready_for_human_review',scope:'exact_stock_configuration_only',structuralStatus:'complete',sourceRefs:[{sourceId:'tt_1',authority:'manufacturer',url:'https://example.org/oem',locator:'original kit'}]};
test('exact OEM evidence becomes non-publishable rule draft',()=>{
 const d=toRuleDraft(official);
 assert.equal(d.reviewStatus,'requires_authorized_source_review');
 assert.equal(d.evidenceStatus,'pending');
 assert.equal(d.result,'unconfirmed');
 assert.equal(d.publicationStatus,'unpublished');
 assert.equal(d.canAutoPublish,false);
 assert.equal(d.canInferCrossCompatibility,false);
 assert.deepEqual(d.partIds,['bit_1','blade_1','ratchet_1']);
});
test('same evidence yields stable ID; changed evidence changes ID',()=>{
 const a=toRuleDraft(official),b=toRuleDraft({...official,partIds:[...official.partIds].reverse()});
 assert.equal(a.draftId,b.draftId);
 const c=toRuleDraft({...official,sourceRefs:[{...official.sourceRefs[0],locator:'new evidence'}]});
 assert.notEqual(a.draftId,c.draftId);
});
test('retailer and single-part candidates cannot become approved drafts',()=>{
 for(const changes of [{status:'source_recheck_required'},{structuralStatus:'pending'},{partIds:['blade_1']},{sourceRefs:[{sourceId:'retail',authority:'retailer',url:'https://example.org',locator:'listing'}]}])
 assert.throws(()=>toRuleDraft({...official,...changes}));
});
test('preview matches only exact full set, not shared blades',()=>{
 const d=toRuleDraft(official);
 const out=reviewImpact(d,{existingConfigurations:[{configId:'same',partIds:[...official.partIds].reverse()},{configId:'partial',partIds:['blade_1','bit_2','ratchet_2']}]});
 assert.deepEqual(out.exactMatches,['same']);
 assert.equal(out.changesPublishedRules,false);
 assert.equal(out.changesPlayerRecords,false);
});
test('candidate compilation excludes unreviewed and loose component records',()=>{
 const d={sources:[{sourceId:'official',url:'https://example.org',authority:'manufacturer'}],products:[{productId:'p1'}],parts:[{partId:'b',category:'blade'},{partId:'r',category:'ratchet'},{partId:'t',category:'bit'}],assemblyClaims:[
  {groupId:'g1',productId:'p1',structure:'一般三件式',verificationStatus:'official_direct',evidence:[{sourceId:'official',locator:'box'}]},
  {groupId:'g2',productId:'p1',structure:'一般三件式',verificationStatus:'supplier_pending',evidence:[{sourceId:'official',locator:'box'}]}],
 contentClaims:[...['g1','g2'].flatMap(groupId=>['b','r','t'].map(partId=>({groupId,partId})))]};
 const rows=compileDrafts(d);assert.equal(rows.length,1);assert.equal(rows[0].groupId,'g1');
});
