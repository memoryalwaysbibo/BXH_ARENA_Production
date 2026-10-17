'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {deriveTaiwanTw04,CX_CATEGORY_ZHTW}=require('../modules/bey-catalog/catalog-tw04-corrections.cjs');
function fixture(){
 const d={batchId:'DATA-01B-20261009',productionWritable:false,autoPublish:false,
 sources:[
  {sourceId:'tt-bx20-manual',authority:'manufacturer',url:'https://beyblade.takaratomy.co.jp/beyblade-x/manual/BX-20_manual.pdf'},
  {sourceId:'tt-image-cx13_07',authority:'manufacturer',url:'https://example.org/CX13_07_list.png'},
  {sourceId:'ux18-official',authority:'manufacturer',url:'https://example.org/ux18'},
  {sourceId:'ux18-supplier',authority:'retailer',url:'https://example.org/supplier'}
 ],
 products:[{productId:'product_000008',productCode:'BX-20'},{productId:'product_000006',productCode:'UX-18'}],
 parts:[{partId:'part_000007',displayName:'LF',category:'bit'},{partId:'part_000013',displayName:'F',category:'bit'},
  {partId:'part_000031',displayName:'1-50',category:'ratchet'},{partId:'part_000034',displayName:'Brush',category:'main_blade'},
  {partId:'part_000037',displayName:'Sol',category:'lock_chip'},{partId:'p1',displayName:'Example',category:'blade'}],
 variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[
  {contentClaimId:'content_000019',productId:'product_000008',groupId:'group_000014',partId:'part_000007'}
 ],issues:[]};
 d.assemblyClaims.push({groupId:'group_000014',productId:'product_000008',displayName:'SharkEdge 3-80LF'});
 for(let i=6;i<=11;i++){
  const n=String(i).padStart(6,'0'),optionId='option_'+n,groupId='group_'+n,official=i===6;
  d.options.push({optionId,productId:'product_000006',probability:null});
  d.assemblyClaims.push({groupId,optionId,productId:'product_000006',originalName:({6:'マミーカース7-55W',7:'マミーカース4-60C',8:'ペガサスブラッシュM3-85W',9:'ソルブレイブC9-70TP',10:'ドランダガー7-55G',11:'ヴァイスタイガー4-80LR'})[i],displayName:'Option '+i,
   verificationStatus:official?'official_direct':'supplier_pending',
   evidence:[{sourceId:official?'ux18-official':'ux18-supplier',role:'composition',locator:'listing'}]});
  d.contentClaims.push({contentClaimId:'claim_'+n,optionId,groupId,productId:'product_000006',partId:'p1'});
 }
 for(let i=1;i<=11;i++)d.variants.push({variantId:'variant_'+String(i).padStart(6,'0'),
  partId:i===10?'part_000031':'p1',sourceProductId:'product_000005',
  displayName:'Variant '+i,colorIds:['black'],evidence:[{sourceId:'tt-image-cx13_07',extractionMethod:'visual_observation'}]});
 while(['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'].reduce((n,k)=>n+d[k].length,0)<197)d.issues.push({issueId:'issue_'+d.issues.length});
 return d;
}

test('five independent corroborations never become manufacturer-approved',()=>{
 const x=deriveTaiwanTw04(fixture());
 assert.equal(x.tw04ReviewSummary.ux18IndependentlyCorroborated,5);
 assert.equal(x.tw04ReviewSummary.manufacturerBoxManualPending,5);
 for(const g of x.assemblyClaims.filter(g=>Number(g.groupId.split('_').pop())>=7&&Number(g.groupId.split('_').pop())<=11)){
  assert.equal(g.verificationStatus,'supplier_pending');
  assert.equal(g.evidenceReview.sourceTier,'independent_catalog_corroborated');
  assert.equal(g.evidenceReview.manufacturerOriginalPartsVerified,false);
  assert.equal(g.evidenceReview.publicationStatus,'unpublished');
  assert.equal(g.canAutoPublish,false);
 }
});
test('manufacturer-named stock is not silently treated as complete package BOM approval',()=>{
 const x=deriveTaiwanTw04(fixture()),g=x.assemblyClaims.find(y=>y.groupId==='group_000006');
 assert.equal(g.evidenceReview.sourceTier,'manufacturer_named_stock');
 assert.equal(g.evidenceReview.manufacturerOriginalPartsVerified,false);
 assert.equal(g.evidenceReview.reviewerDecision,'pending');
});
test('CX part category labels are Taiwanese while original machine codes remain unchanged',()=>{
 const x=deriveTaiwanTw04(fixture());
 assert.equal(x.parts.find(p=>p.partId==='part_000034').categoryZhTW,'主刀刃');
 assert.equal(x.parts.find(p=>p.partId==='part_000037').categoryZhTW,'紋章');
 assert.equal(x.parts.find(p=>p.partId==='part_000013').category,'bit');
 assert.equal(x.parts.find(p=>p.partId==='part_000013').categoryZhTW,'軸心');
 assert(x.parts.every(p=>p.selectable===false));
 assert.equal(CX_CATEGORY_ZHTW.over_blade,'覆蓋刀刃');
});
test('original 197 research records and TW-02 corrected F bit are preserved',()=>{
 const d=fixture(),before=JSON.stringify(d),x=deriveTaiwanTw04(d);
 assert.equal(x.batchId,'DATA-01B-20261009-ZHTW-TW04');
 assert.equal(x.contentClaims.find(y=>y.contentClaimId==='content_000019').partId,'part_000013');
 assert.equal(x.productionWritable,false);assert.equal(x.autoPublish,false);
 assert.equal(JSON.stringify(d),before);
 const sections=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
 assert.equal(sections.reduce((n,k)=>n+x[k].length,0),197);
});
test('mismatched original UX-18 identity is blocked',()=>{
 const d=fixture();d.assemblyClaims.find(g=>g.groupId==='group_000008').originalName='wrong';
 assert.throws(()=>deriveTaiwanTw04(d),/TW04_SOURCE_SCOPE_MISMATCH/);
});
