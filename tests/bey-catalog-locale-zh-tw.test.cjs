'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PRODUCT_NAMES,PART_NAMES,GROUP_NAMES,VARIANT_NAMES,localizeRecord,localizeCatalog}=require('../modules/bey-catalog/catalog-locale-zh-tw.cjs');
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
