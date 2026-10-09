'use strict';
/**
 * Draft conversion only: a reviewed OEM configuration does not grant a publishable
 * physical-compatibility rule. A server-side authorization + source review is still required.
 */
const crypto=require('node:crypto');
const {createOriginalAssemblyCandidates}=require('./stock-evidence-candidates.cjs');
function digest(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function toRuleDraft(candidate){
 if(!candidate||candidate.status!=='ready_for_human_review'||candidate.scope!=='exact_stock_configuration_only'||candidate.structuralStatus!=='complete')throw Error('CANDIDATE_NOT_READY');
 if(!Array.isArray(candidate.partIds)||candidate.partIds.length<2||new Set(candidate.partIds).size!==candidate.partIds.length)throw Error('INVALID_PARTS');
 if(!Array.isArray(candidate.sourceRefs)||!candidate.sourceRefs.some(s=>s.authority==='manufacturer'&&typeof s.url==='string'&&s.url.startsWith('https://')&&s.locator))throw Error('MANUFACTURER_EVIDENCE_REQUIRED');
 const partIds=[...candidate.partIds].sort();
 const sourceRefs=candidate.sourceRefs.map(s=>({sourceId:s.sourceId,url:s.url,locator:s.locator,authority:s.authority}));
 const payload={candidateId:candidate.candidateId,groupId:candidate.groupId,productId:candidate.productId,partIds,sourceRefs,scope:'exact_stock_configuration_only'};
 return Object.freeze({...payload,draftId:'draft_'+digest(payload).slice(0,24),reviewStatus:'requires_authorized_source_review',evidenceStatus:'pending',result:'unconfirmed',publicationStatus:'unpublished',selectable:false,canAutoPublish:false,canInferCrossCompatibility:false});
}
function compileDrafts(dataset){
 return createOriginalAssemblyCandidates(dataset).filter(c=>c.status==='ready_for_human_review').map(toRuleDraft);
}
function reviewImpact(draft,{existingConfigurations=[]}={}){
 if(!draft||draft.reviewStatus!=='requires_authorized_source_review'||!Array.isArray(existingConfigurations))throw Error('INVALID_REVIEW_INPUT');
 const key=ids=>[...ids].sort().join('|');
 const matches=existingConfigurations.filter(c=>Array.isArray(c.partIds)&&key(c.partIds)===key(draft.partIds)).map(c=>c.configId);
 return Object.freeze({draftId:draft.draftId,exactMatches:matches,affectedExistingConfigurations:matches.length,requiresAdminReview:true,changesPublishedRules:false,changesPlayerRecords:false});
}
module.exports={toRuleDraft,compileDrafts,reviewImpact};
