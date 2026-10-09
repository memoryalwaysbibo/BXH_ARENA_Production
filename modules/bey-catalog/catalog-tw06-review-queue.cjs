'use strict';
/** TW-06 read-only review queue derived from the actual TW-05 evidence flags. */
const {digest}=require('./catalog-tw06-review.cjs');
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
const priority={P0:0,P1:1,P2:2};
function buildTw06ReviewQueue(batch){
 if(!batch||batch.batchId!=='DATA-01B-20261009-ZHTW-TW05'||batch.productionWritable!==false||batch.autoPublish!==false)throw Error('TW06_QUEUE_RESEARCH_REQUIRED');
 if(SECTIONS.some(s=>!Array.isArray(batch[s]))||SECTIONS.reduce((n,s)=>n+batch[s].length,0)!==197)throw Error('TW06_QUEUE_EXPECTED_197');
 const items=[];
 function add(section,id,code,level,details){
  if(!id)throw Error('TW06_QUEUE_ID_REQUIRED');
  const key=section+'/'+id+'/'+code;
  items.push({queueId:'review_'+digest(key).slice(0,20),section,recordId:id,reasonCode:code,priority:level,
   details,reviewState:'pending',evidenceVerified:false,canAutoPublish:false});
 }
 for(const p of batch.products){
  if(p.localizationStatus==='provisional_translation')add('products',p.productId,'TAIWAN_PRODUCT_NAME_PENDING','P1','需台灣正式商品名稱證據');
 }
 for(const p of batch.parts){
  if(['taiwan_name_pending','provisional_translation'].includes(p.localizationStatus))add('parts',p.partId,'TAIWAN_PART_NAME_PENDING','P1','需原廠或台灣正式零件名稱證據');
  if(p.verificationStatus==='supplier_pending')add('parts',p.partId,'PART_SOURCE_PENDING','P1','零件來源仍為商家資料，須確認原廠零件規格');
 }
 for(const g of batch.assemblyClaims){
  if(g.requiresManufacturerCompositionReview===true||g.verificationStatus==='supplier_pending')
   add('assemblyClaims',g.groupId,'ORIGINAL_COMPOSITION_PENDING','P0','商家來源或交叉佐證不足，須補原廠包裝／說明書');
  if(g.localizationStatus==='taiwan_name_pending_supplier_source')
   add('assemblyClaims',g.groupId,'ASSEMBLY_TAIWAN_NAME_PENDING','P1','原配中文名稱尚無台灣正式證據');
  if(g.localizationStatus==='needs_original_kit_recheck')
   add('assemblyClaims',g.groupId,'ORIGINAL_KIT_RECHECK','P0','原配 BOM 更正須核對原廠來源與修正歷程');
 }
 for(const v of batch.variants){
  if(v.colorPhysicalVerification==='pending'||v.colorEvidenceStatus==='image_observation_unverified')
   add('variants',v.variantId,'PHYSICAL_COLOR_PENDING','P2','商品圖色系不等於實物配色驗證');
  if(['needs_source_recheck','product_source_verified_color_pending'].includes(v.localizationStatus))
   add('variants',v.variantId,'VARIANT_SOURCE_PENDING','P1','需核對配色版本對應產品');
 }
 const unique=new Set(items.map(i=>i.queueId));
 if(unique.size!==items.length)throw Error('TW06_QUEUE_DUPLICATE');
 items.sort((a,b)=>priority[a.priority]-priority[b.priority]||a.section.localeCompare(b.section)||a.recordId.localeCompare(b.recordId)||a.reasonCode.localeCompare(b.reasonCode));
 return {batchId:batch.batchId,queueVersion:'TW06-1',items,
  summary:{total:items.length,P0:items.filter(i=>i.priority==='P0').length,P1:items.filter(i=>i.priority==='P1').length,P2:items.filter(i=>i.priority==='P2').length},
  productionWritable:false,autoPublish:false};
}
module.exports={buildTw06ReviewQueue};
