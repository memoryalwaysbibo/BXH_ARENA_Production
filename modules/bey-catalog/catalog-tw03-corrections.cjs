'use strict';
const {buildTaiwanTw02}=require('./catalog-tw02-corrections.cjs');
const {auditTw03}=require('./catalog-tw03-evidence-audit.cjs');
const ID='DATA-01B-20261009-ZHTW-TW03';
function deriveTaiwanTw03(base){
 const review=auditTw03(base);
 const out=buildTaiwanTw02(base);
 const safe=new Map([
  ['group_000008','天馬 Brush M3-85W（台灣名稱待核）'],
  ['group_000009','Sol Brave C9-70TP（台灣名稱待核）']
 ]);
 const partNames=new Map([
  ['part_000034','Brush（台灣名稱待核）'],
  ['part_000037','Sol（台灣名稱待核）']
 ]);
 for(const part of out.parts)if(partNames.has(part.partId)){
  part.displayName=partNames.get(part.partId);part.displayNameZhTW=part.displayName;
  part.localizationStatus='taiwan_name_pending';
 }
 for(const group of out.assemblyClaims){
  const evidence=review.ux18.find(x=>x.groupId===group.groupId);
  if(!evidence)continue;
  if(safe.has(group.groupId)){
   group.displayName=safe.get(group.groupId);group.displayNameZhTW=group.displayName;
   group.localizationStatus='taiwan_name_pending_supplier_source';
  }
  group.compositionSourceStatus=evidence.sourceClass;
  group.requiresManufacturerCompositionReview=evidence.requiresManufacturerCompositionReview;
  group.canAutoApprove=false;group.canAutoPublish=false;
 }
 for(const option of out.options){
  const evidence=review.ux18.find(x=>x.optionId===option.optionId);
  if(!evidence)continue;
  option.probability=null;
  option.compositionSourceStatus=evidence.sourceClass;
  option.requiresManufacturerCompositionReview=evidence.requiresManufacturerCompositionReview;
  option.canAutoPublish=false;
 }
 for(const variant of out.variants){
  const evidence=review.variants.find(x=>x.variantId===variant.variantId);
  if(!evidence)throw Error('TW03_VARIANT_MISSING');
  variant.colorEvidenceStatus=evidence.colorStatus;
  variant.canAutoPublish=false;
  variant.mayCopyColorsToUx18=false;
 }
 out.batchId=ID;out.batchRevision=5;out.localizationRevision=3;
 out.tw03ReviewSummary=review.counts;
 out.tw03Corrections=[
  {id:'TW03-UX18-001',kind:'unverified_taiwan_name',partId:'part_000034',groupId:'group_000008',status:'pending'},
  {id:'TW03-UX18-002',kind:'unverified_taiwan_name',partId:'part_000037',groupId:'group_000009',status:'pending'},
  {id:'TW03-UX18-003',kind:'supplier_composition_review',groups:review.ux18.filter(x=>x.requiresManufacturerCompositionReview).map(x=>x.groupId),status:'pending'},
  {id:'TW03-COLOR-004',kind:'image_observed_color_variants',count:review.counts.imageObservedColorCandidates,status:'pending_physical_color_verification'}
 ];
 out.productionWritable=false;out.autoPublish=false;
 const sections=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
 if(sections.reduce((n,k)=>n+out[k].length,0)!==197)throw Error('TW03_RECORD_COUNT_CHANGED');
 return out;
}
module.exports={deriveTaiwanTw03};
