'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PRODUCT_NAMES,PART_NAMES,GROUP_NAMES,VARIANT_NAMES,TAIWAN_CORRECTION_CANDIDATES,localizeRecord,localizeCatalog}=require('../modules/bey-catalog/catalog-locale-zh-tw.cjs');
test('all nine products use Taiwan Traditional Chinese primary names',()=>{
 assert.equal(Object.keys(PRODUCT_NAMES).length,9);
 for(const n of Object.values(PRODUCT_NAMES))assert(!/[\u3040-\u309f\u30a0-\u30fa\u30fc-\u30ff]/.test(n));
});
test('16 original configurations and 11 color candidates are mapped',()=>{
 assert.equal(GROUP_NAMES.length,16);assert.equal(VARIANT_NAMES.length,11);
 assert.equal(PART_NAMES.part_000008,'古屍詛咒');
 assert.equal(GROUP_NAMES[4],'龍王閃擊 BK1-50I');
});
test('original Japanese names, identifiers, codes and familiar aliases preserved',()=>{
 const x={productId:'product_000002',productCode:'UX-19',displayName:'子彈獅鷲 H',officialNames:{ja:'バレットグリフォンH'},aliases:['バレットグリフォンH']};
 const y=localizeRecord('products',x);
 assert.equal(y.displayName,'彈丸獅鷲 H');assert.equal(y.officialNames.ja,x.officialNames.ja);
 assert(y.aliases.includes('子彈獅鷲 H'));assert(y.aliases.includes('彈丸獅鷲 H'));
 assert.equal(y.productId,x.productId);assert.equal(x.displayName,'子彈獅鷲 H');
});
test('unconfirmed names and conflicting original kit data flagged',()=>{
 const p=localizeRecord('products',{productId:'product_000009',productCode:'CX-00',displayName:'Dran'});
 assert.equal(p.localizationStatus,'provisional_translation');
 const v=localizeRecord('variants',{variantId:'variant_000010',displayName:'1-50'});
 assert.equal(v.localizationStatus,'needs_source_recheck');
 const g=localizeRecord('assemblyClaims',{groupId:'group_000014',displayName:'SharkEdge 3-80LF'});
 assert.equal(g.localizationStatus,'needs_original_kit_recheck');
});
test('cannot transform writable or auto-publish payload',()=>{
 assert.throws(()=>localizeCatalog({productionWritable:true,autoPublish:false}),/RESEARCH_ONLY/);
 assert.throws(()=>localizeCatalog({productionWritable:false,autoPublish:true}),/RESEARCH_ONLY/);
 const x={batchId:'BATCH',productionWritable:false,autoPublish:false,products:[],parts:[],variants:[],assemblyClaims:[]};
 const y=localizeCatalog(x);
 assert.equal(y.locale,'zh-TW');assert.equal(y.productionWritable,false);assert.equal(x.locale,undefined);
});

test('Taiwan BX-20 F notation remains a visible candidate, not silent BOM overwrite',()=>{
 const group=localizeRecord('assemblyClaims',{groupId:'group_000014',displayName:'SharkEdge 3-80LF',bitCode:'LF'});
 assert(group.displayName.includes('3-80F'));
 assert.equal(group.bitCode,'LF');
 assert.equal(group.localizationStatus,'needs_original_kit_recheck');
 assert.equal(TAIWAN_CORRECTION_CANDIDATES['assemblyClaims:group_000014'].candidateBit,'F');
});
test('CX-07 variant attribution remains quarantined pending color evidence',()=>{
 const variant=localizeRecord('variants',{variantId:'variant_000010',displayName:'1-50',sourceProductCode:'CX-07'});
 assert.equal(variant.sourceProductCode,'CX-07');
 assert(variant.displayName.includes('待核對'));
 assert.equal(variant.localizationStatus,'needs_source_recheck');
});

test('Dran lock-chip tentative translation remains in the pending review queue',()=>{
 const x={partId:'part_000022',displayName:'Dran 鎖定紋章',category:'lock_chip'};
 const y=localizeRecord('parts',x);
 assert.equal(y.localizationStatus,'provisional_translation');
 assert.equal(x.displayName,'Dran 鎖定紋章');
});
