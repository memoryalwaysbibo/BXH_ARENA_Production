'use strict';
/**
 * TW-03 evidence audit for UX-18 and CX appearance.
 * No claims are promoted; no variant colors are copied across products.
 */
const UX18='product_000006';
const EXPECTED=Object.freeze([
 ['option_000006','group_000006','official_direct'],
 ['option_000007','group_000007','supplier_pending'],
 ['option_000008','group_000008','supplier_pending'],
 ['option_000009','group_000009','supplier_pending'],
 ['option_000010','group_000010','supplier_pending'],
 ['option_000011','group_000011','supplier_pending']
]);
const PENDING_TW_NAMES=Object.freeze({
 'part_000034':{original:'Brush｜ブラッシュ',safeDisplay:'Brush（台灣名稱待核）',reason:'Brush is not 九尾; do not invent a Taiwanese localized name'},
 'part_000037':{original:'Sol｜ソル',safeDisplay:'Sol（台灣名稱待核）',reason:'Sol is not verified as 焰神 in Taiwanese sources'}
});
function auditTw03(batch){
 if(!batch||batch.batchId!=='DATA-01B-20261009'||batch.productionWritable!==false||batch.autoPublish!==false)throw Error('TW03_RESEARCH_BATCH_REQUIRED');
 for(const section of ['sources','products','parts','variants','options','assemblyClaims','contentClaims'])
  if(!Array.isArray(batch[section]))throw Error('TW03_MISSING_'+section);
 const src=new Map(batch.sources.map(x=>[x.sourceId,x]));
 const parts=new Map(batch.parts.map(x=>[x.partId,x]));
 const options=batch.options.filter(x=>x.productId===UX18);
 const groups=batch.assemblyClaims.filter(x=>x.productId===UX18);
 if(options.length!==6||groups.length!==6)throw Error('TW03_UX18_SIX_REQUIRED');
 const rows=EXPECTED.map(([optionId,groupId,expected])=>{
  const option=options.find(x=>x.optionId===optionId),group=groups.find(x=>x.groupId===groupId);
  if(!option||!group||group.optionId!==optionId||group.verificationStatus!==expected)throw Error('TW03_OPTION_GROUP_MISMATCH');
  const contents=batch.contentClaims.filter(x=>x.groupId===groupId);
  if(!contents.length||contents.some(c=>c.optionId!==optionId||c.productId!==UX18||!parts.has(c.partId)))throw Error('TW03_CONTENT_SCOPE_MISMATCH');
  const compositional=(group.evidence||[]).filter(e=>e.role==='composition'||!e.role).map(e=>({sourceId:e.sourceId,authority:src.get(e.sourceId)?.authority||null,locator:e.locator}));
  if(!compositional.length||compositional.some(e=>!e.authority))throw Error('TW03_SOURCE_MISSING');
  const verified=expected==='official_direct'&&compositional.some(e=>e.authority==='manufacturer');
  if(expected==='supplier_pending'&&compositional.some(e=>e.authority==='manufacturer'))throw Error('TW03_SOURCE_CLASSIFICATION_RECHECK');
  return {optionId,groupId,originalName:group.displayName,partIds:contents.map(c=>c.partId),
   sourceClass:verified?'manufacturer_product_name':'retailer_composition_pending',
   evidence:compositional,requiresManufacturerCompositionReview:!verified,
   canAutoPublish:false,canAutoApprove:false,probability:null};
 });
 const variants=batch.variants.map(v=>{
  const evidence=(v.evidence||[]).map(e=>({sourceId:e.sourceId,authority:src.get(e.sourceId)?.authority||null,extractionMethod:e.extractionMethod||null}));
  return {variantId:v.variantId,partId:v.partId,sourceProductId:v.sourceProductId||null,
   appearanceEvidence:evidence,colors:(v.colorIds||[]).slice(),
   colorStatus:v.variantId==='variant_000001'?'official_named_version':'image_observation_unverified',
   mayCopyColorsToUx18:false,canAutoPublish:false};
 });
 return {batchId:batch.batchId,locale:'zh-TW',ux18:rows,
  counts:{ux18Options:rows.length,manufacturerNameOnly:rows.filter(x=>x.sourceClass==='manufacturer_product_name').length,
    supplierCompositionsPending:rows.filter(x=>x.requiresManufacturerCompositionReview).length,
    variants:variants.length,imageObservedColorCandidates:variants.filter(x=>x.colorStatus==='image_observation_unverified').length},
  variants,unverifiedTaiwanNames:PENDING_TW_NAMES,
  publicationStatus:'unpublished',autoPublish:false,productionWritable:false};
}
module.exports={auditTw03,PENDING_TW_NAMES};
