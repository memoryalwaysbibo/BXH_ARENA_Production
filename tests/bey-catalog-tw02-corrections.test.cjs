'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildTaiwanTw02}=require('../modules/bey-catalog/catalog-tw02-corrections.cjs');
function fixture(){
 const x={batchId:'DATA-01B-20261009',productionWritable:false,autoPublish:false,
 sources:[
  {sourceId:'tt-bx20-manual',authority:'manufacturer',url:'https://beyblade.takaratomy.co.jp/beyblade-x/manual/BX-20_manual.pdf'},
  {sourceId:'tt-image-cx13_07',authority:'manufacturer',url:'https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/CX13_07_list.png'}
 ],
 products:[{productId:'product_000008',productCode:'BX-20',displayName:'DranDagger deck'}],
 parts:[{partId:'part_000007',displayName:'LF',category:'bit'},{partId:'part_000013',displayName:'F',category:'bit'}],
 variants:[{variantId:'variant_000010',partId:'part_000031',displayName:'1-50｜CX-07 圖示版本',sourceProductId:'product_000005'}],
 colors:[],options:[],
 assemblyClaims:[{groupId:'group_000014',productId:'product_000008',displayName:'SharkEdge 3-80LF'}],
 contentClaims:[{contentClaimId:'content_000019',productId:'product_000008',groupId:'group_000014',partId:'part_000007'}],
 issues:[]};
 while(Object.entries(x).filter(([k,v])=>Array.isArray(v)).reduce((n,[,v])=>n+v.length,0)<197)x.issues.push({issueId:'issue_'+x.issues.length});
 return x;
}
test('TW-02 corrects actual BX-20 bit identity, not only the display label',()=>{
 const original=fixture(),before=structuredClone(original),tw=buildTaiwanTw02(original);
 assert.equal(tw.contentClaims[0].partId,'part_000013');
 assert.equal(tw.assemblyClaims[0].displayName,'鮫鯊鋒鰭 3-80F');
 assert.equal(tw.assemblyClaims[0].localizationStatus,'manufacturer_manual_verified');
 assert.equal(tw.contentClaims[0].dataCorrection.fromPartId,'part_000007');
 assert.equal(tw.contentClaims[0].dataCorrection.sourcePage,1);
 assert.deepEqual(original,before);
});
test('CX-13 already owns 1-50; correct display only and keep color pending',()=>{
 const tw=buildTaiwanTw02(fixture()),v=tw.variants[0];
 assert.equal(v.sourceProductId,'product_000005');
 assert(v.displayName.includes('CX-13'));
 assert.equal(v.localizationStatus,'product_source_verified_color_pending');
 assert.equal(tw.tw02Corrections[1].approvedForPublication,false);
});
test('197 records and research-only flags remain unchanged',()=>{
 const tw=buildTaiwanTw02(fixture());
 assert.equal(Object.values(tw).filter(Array.isArray).reduce((n,a)=>n+a.length,0)-tw.tw02Corrections.length,197);
 assert.equal(tw.productionWritable,false);assert.equal(tw.autoPublish,false);
 assert.equal(tw.sourceBatchId,'DATA-01B-20261009');
});
test('missing manufacturer source, changed original BOM or wrong source product blocks correction',()=>{
 const a=fixture();a.sources[0].authority='retailer';assert.throws(()=>buildTaiwanTw02(a),/TW02_OFFICIAL_SOURCE_MISSING/);
 const b=fixture();b.contentClaims[0].partId='part_000013';assert.throws(()=>buildTaiwanTw02(b),/TW02_ORIGINAL_BOM_CHANGED/);
 const c=fixture();c.variants[0].sourceProductId='product_000004';assert.throws(()=>buildTaiwanTw02(c),/TW02_CX13_SCOPE_CHANGED/);
});
