'use strict';
/**
 * Converts researched OEM compositions into review candidates, never published rules.
 * Distinguishes evidence for one exact stock configuration from arbitrary cross-compatibility.
 */
const {structuralCheck}=require('./assembly-validator.cjs');
function createOriginalAssemblyCandidates(dataset){
 if(!dataset||!Array.isArray(dataset.sources)||!Array.isArray(dataset.products)||!Array.isArray(dataset.parts)||!Array.isArray(dataset.assemblyClaims)||!Array.isArray(dataset.contentClaims))throw Error('RESEARCH_DATA_REQUIRED');
 const sourceById=new Map(dataset.sources.map(x=>[x.sourceId,x]));
 const partById=new Map(dataset.parts.map(x=>[x.partId,x]));
 const productById=new Map(dataset.products.map(x=>[x.productId,x]));
 const output=[];
 for(const group of dataset.assemblyClaims){
  const product=productById.get(group.productId);
  const claims=dataset.contentClaims.filter(x=>x.groupId===group.groupId);
  const partIds=claims.map(x=>x.partId);
  const parts=partIds.map(id=>partById.get(id));
  const structural=structuralCheck(parts,group.structure);
  const refs=(group.evidence||[]).map(e=>{
   const source=sourceById.get(e.sourceId);
   return {sourceId:e.sourceId,url:source?.url||null,authority:source?.authority||null,locator:e.locator||null};
  });
  const allSourcesKnown=refs.length>0&&refs.every(x=>x.url?.startsWith('https://')&&x.locator);
  const manufacturerEvidence=refs.some(x=>x.authority==='manufacturer');
  const direct=group.verificationStatus==='official_direct'||group.verificationStatus==='official_cross_checked';
  const stockCandidate=structural.status==='complete'&&allSourcesKnown&&manufacturerEvidence&&direct;
  const status=structural.status!=='complete'?'not_full_assembly':stockCandidate?'ready_for_human_review':'source_recheck_required';
  output.push({
   candidateId:'stock_'+group.groupId,groupId:group.groupId,productId:group.productId,productCode:product?.productCode||null,
   displayName:group.displayName,structure:group.structure,partIds,verificationStatus:group.verificationStatus,
   status,scope:'exact_stock_configuration_only',sourceRefs:refs,
   canAutoPublish:false,canAutoMarkSelectable:false,canAutoInferCrossCompatibility:false,
   structuralStatus:structural.status,structuralReason:structural.reason,
   needsAdminApproval:true
  });
 }
 return output;
}
function approveOriginalAssemblyCandidate(candidate,{reviewerId,reviewedAt,sourceRechecked}={}){
 if(candidate?.status!=='ready_for_human_review'||candidate.scope!=='exact_stock_configuration_only')throw Error('CANDIDATE_NOT_READY');
 if(!sourceRechecked||!reviewerId||!/^\d{4}-\d{2}-\d{2}T/.test(reviewedAt||''))throw Error('EXPLICIT_REVIEW_REQUIRED');
 if(!Array.isArray(candidate.partIds)||candidate.partIds.length<2||new Set(candidate.partIds).size!==candidate.partIds.length)throw Error('PARTS_INVALID');
 return {candidateId:candidate.candidateId,groupId:candidate.groupId,partIds:[...candidate.partIds],
  reviewState:'approved_for_rule_draft',scope:'exact_stock_configuration_only',reviewerId,reviewedAt,
  sourceRefs:candidate.sourceRefs,publicationStatus:'unpublished',selectable:false};
}
module.exports={createOriginalAssemblyCandidates,approveOriginalAssemblyCandidate};
