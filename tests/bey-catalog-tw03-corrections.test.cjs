'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {deriveTaiwanTw03}=require('../modules/bey-catalog/catalog-tw03-corrections.cjs');
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
  d.assemblyClaims.push({groupId,optionId,productId:'product_000006',displayName:'Option '+i,
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
test('TW-03 keeps 197 original entities, six options, five supplier reviews and 10 visual candidates',()=>{
 const d=fixture(),before=JSON.stringify(d),tw=deriveTaiwanTw03(d);
 assert.equal(tw.batchId,'DATA-01B-20261009-ZHTW-TW03');
 assert.equal(tw.tw03ReviewSummary.ux18Options,6);
 assert.equal(tw.tw03ReviewSummary.supplierCompositionsPending,5);
 assert.equal(tw.tw03ReviewSummary.imageObservedColorCandidates,10);
 assert.equal(tw.productionWritable,false);assert.equal(tw.autoPublish,false);
 assert.equal(JSON.stringify(d),before);
});
test('unsupported 九尾 and 焰神 translations are quarantined',()=>{
 const tw=deriveTaiwanTw03(fixture());
 assert(tw.parts.find(x=>x.partId==='part_000034').displayName.includes('Brush'));
 assert(tw.parts.find(x=>x.partId==='part_000037').displayName.includes('Sol'));
 assert(tw.assemblyClaims.find(x=>x.groupId==='group_000008').displayName.includes('台灣名稱待核'));
 assert(tw.assemblyClaims.find(x=>x.groupId==='group_000009').displayName.includes('台灣名稱待核'));
});
test('TW-02 BX-20 correction is preserved and UX-18 colors never auto-publish',()=>{
 const tw=deriveTaiwanTw03(fixture());
 assert.equal(tw.contentClaims.find(x=>x.contentClaimId==='content_000019').partId,'part_000013');
 assert(tw.variants.every(x=>x.mayCopyColorsToUx18===false&&x.canAutoPublish===false));
 assert(tw.options.filter(x=>x.productId==='product_000006').every(x=>x.probability===null&&x.canAutoPublish===false));
});
test('invalid supplier authority is blocked before localization',()=>{
 const d=fixture();d.sources.find(x=>x.sourceId==='ux18-supplier').authority='manufacturer';
 assert.throws(()=>deriveTaiwanTw03(d),/TW03_SOURCE_CLASSIFICATION_RECHECK/);
});
