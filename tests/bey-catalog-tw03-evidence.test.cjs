'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {auditTw03,PENDING_TW_NAMES}=require('../modules/bey-catalog/catalog-tw03-evidence-audit.cjs');
function fixture(){
 const d={batchId:'DATA-01B-20261009',productionWritable:false,autoPublish:false,
 sources:[{sourceId:'oem',authority:'manufacturer'},{sourceId:'retail',authority:'retailer'},{sourceId:'image',authority:'manufacturer'}],
 products:[],parts:[{partId:'p1'},{partId:'p2'},{partId:'p3'}],variants:[],options:[],assemblyClaims:[],contentClaims:[]};
 for(let n=6;n<=11;n++){
  const i=String(n).padStart(6,'0'),optionId='option_'+i,groupId='group_'+i,official=n===6;
  d.options.push({optionId,productId:'product_000006',probability:null});
  d.assemblyClaims.push({groupId,optionId,productId:'product_000006',displayName:'Candidate '+n,
   verificationStatus:official?'official_direct':'supplier_pending',
   evidence:[{sourceId:official?'oem':'retail',role:'composition',locator:'composition '+n}]});
  d.contentClaims.push({contentClaimId:'content_'+i,optionId,groupId,productId:'product_000006',partId:'p1'});
 }
 for(let n=1;n<=11;n++)d.variants.push({variantId:'variant_'+String(n).padStart(6,'0'),partId:'p2',
  sourceProductId:'product_000005',colorIds:['pink'],
  evidence:[{sourceId:'image',extractionMethod:'visual_observation'}]});
 return d;
}
test('six UX-18 rows remain one manufacturer-name and five retailer-pending',()=>{
 const x=auditTw03(fixture());
 assert.deepEqual([x.counts.ux18Options,x.counts.manufacturerNameOnly,x.counts.supplierCompositionsPending],[6,1,5]);
 assert(x.ux18.every(y=>y.probability===null&&!y.canAutoPublish&&!y.canAutoApprove));
 assert.equal(x.publicationStatus,'unpublished');
});
test('CX appearance candidates cannot be copied into UX-18 or auto-published',()=>{
 const x=auditTw03(fixture());
 assert.equal(x.counts.variants,11);
 assert.equal(x.counts.imageObservedColorCandidates,10);
 assert(x.variants.every(v=>!v.mayCopyColorsToUx18&&!v.canAutoPublish));
});
test('misleading translations are flagged without inventing Taiwan official names',()=>{
 assert(PENDING_TW_NAMES.part_000034.safeDisplay.includes('Brush'));
 assert(PENDING_TW_NAMES.part_000037.safeDisplay.includes('Sol'));
 assert(!PENDING_TW_NAMES.part_000034.safeDisplay.includes('九尾'));
});
test('wrong source authority, missing option or foreign content is rejected',()=>{
 const a=fixture();a.assemblyClaims[1].evidence[0].sourceId='oem';
 assert.throws(()=>auditTw03(a),/TW03_SOURCE_CLASSIFICATION_RECHECK/);
 const b=fixture();b.options.pop();assert.throws(()=>auditTw03(b),/TW03_UX18_SIX_REQUIRED/);
 const c=fixture();c.contentClaims[0].productId='another';
 assert.throws(()=>auditTw03(c),/TW03_CONTENT_SCOPE_MISMATCH/);
});
test('review report is nonmutating and refuses auto-publish inputs',()=>{
 const d=fixture(),snapshot=JSON.stringify(d);auditTw03(d);
 assert.equal(JSON.stringify(d),snapshot);
 assert.throws(()=>auditTw03({...d,autoPublish:true}),/TW03_RESEARCH_BATCH_REQUIRED/);
});
