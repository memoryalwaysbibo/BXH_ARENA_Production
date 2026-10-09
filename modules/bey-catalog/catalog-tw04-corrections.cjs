'use strict';
/**
 * TW-04 external corroboration of UX-18 package contents, plus Traditional Chinese
 * structural labels. No official-manufacturer status promotion or player publication.
 */
const {deriveTaiwanTw03}=require('./catalog-tw03-corrections.cjs');
const CX_CATEGORY_ZHTW=Object.freeze({
 lock_chip:'紋章',main_blade:'主刀刃',assist_blade:'輔助刀刃',
 over_blade:'覆蓋刀刃',metal_blade:'金屬刀刃',
 blade:'上盤',ratchet:'固鎖',bit:'軸心',
 blade_ratchet:'上盤與固鎖一體式',ratchet_bit:'固鎖與軸心一體式'
});
const CROSSCHECK=Object.freeze({
 group_000007:Object.freeze({model:'UX-18-02',expectedOriginal:'マミーカース4-60C',urls:['https://beyblade.phstudy.org/p/en-US/SR-PRD-097167-02.html','https://www.1999.co.jp/11228862']}),
 group_000008:Object.freeze({model:'UX-18-03',expectedOriginal:'ペガサスブラッシュM3-85W',urls:['https://beyblade-toys.com/products/random-booster-ux-18','https://www.1999.co.jp/11228862']}),
 group_000009:Object.freeze({model:'UX-18-04',expectedOriginal:'ソルブレイブC9-70TP',urls:['https://beyblade-toys.com/products/random-booster-ux-18','https://www.1999.co.jp/11228862']}),
 group_000010:Object.freeze({model:'UX-18-05',expectedOriginal:'ドランダガー7-55G',urls:['https://beyblade.phstudy.org/p/ja-JP/SR-PRD-097167-05.html','https://www.1999.co.jp/11228862']}),
 group_000011:Object.freeze({model:'UX-18-06',expectedOriginal:'ヴァイスタイガー4-80LR',urls:['https://beyblade.phstudy.org/p/en-US/SR-PRD-097167-06.html','https://www.1999.co.jp/11228862']})
});
const REVIEW_CATEGORIES=Object.freeze(['source_only','independent_catalog_corroborated','manufacturer_original_verified']);
function deriveTaiwanTw04(base){
 const tw=deriveTaiwanTw03(base);
 const groups=new Map(tw.assemblyClaims.map(g=>[g.groupId,g]));
 for(const [id,proof] of Object.entries(CROSSCHECK)){
  const group=groups.get(id);
  if(!group||group.originalName!==proof.expectedOriginal||group.verificationStatus!=='supplier_pending')throw Error('TW04_SOURCE_SCOPE_MISMATCH:'+id);
  group.evidenceReview={
   model:proof.model,sourceTier:'independent_catalog_corroborated',
   independentSourceUrls:[...proof.urls],
   manufacturerOriginalPartsVerified:false,
   manualOrBoxPhotoRequired:true,
   requiresManufacturerCompositionReview:true,
   reviewerDecision:'pending',
   publicationStatus:'unpublished'
  };
  group.compositionSourceStatus='independent_catalog_corroborated';
  group.requiresManufacturerCompositionReview=true;
  group.canAutoApprove=false;group.canAutoPublish=false;
 }
 const official=groups.get('group_000006');
 if(!official||official.verificationStatus!=='official_direct')throw Error('TW04_OFFICIAL_ROW_MISSING');
 official.evidenceReview={model:'UX-18-01',sourceTier:'manufacturer_original_verified',
  manufacturerOriginalPartsVerified:true,reviewerDecision:'pending',publicationStatus:'unpublished'};
 for(const part of tw.parts){
  const label=CX_CATEGORY_ZHTW[part.category];
  if(!label)throw Error('TW04_UNKNOWN_PART_CATEGORY:'+part.category);
  part.categoryZhTW=label;
  part.originalCategory=part.category;
  part.selectable=false;
 }
 for(const v of tw.variants){v.colorPhysicalVerification='pending';v.canAutoPublish=false;}
 tw.batchId='DATA-01B-20261009-ZHTW-TW04';
 tw.batchRevision=6;tw.localizationRevision=4;
 tw.tw04ReviewSummary={ux18ManufacturerDirect:1,ux18IndependentlyCorroborated:5,
  manufacturerBoxManualPending:5,unverifiedColorVariants:10,autoPublished:0};
 tw.tw04Corrections=Object.keys(CROSSCHECK).map(id=>({
  id:'TW04-'+id,groupId:id,kind:'independent_catalog_corroboration',
  sourceTier:'independent_catalog_corroborated',needsOfficialPackageProof:true,approvedForPublication:false
 }));
 tw.productionWritable=false;tw.autoPublish=false;
 const sections=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
 if(sections.reduce((sum,s)=>sum+tw[s].length,0)!==197)throw Error('TW04_RECORD_COUNT_CHANGED');
 return tw;
}
module.exports={deriveTaiwanTw04,CROSSCHECK,CX_CATEGORY_ZHTW,REVIEW_CATEGORIES};
