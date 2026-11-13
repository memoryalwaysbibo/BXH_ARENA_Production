'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {applyTw05ColorLabels,COLOR_FAMILIES}=require('../modules/bey-catalog/catalog-tw05-colors.cjs');
const ids=Object.keys(COLOR_FAMILIES);
function fixture(){
 const x={batchId:'DATA-01B-20261009-ZHTW-TW04',productionWritable:false,autoPublish:false,
 sources:[],products:[],parts:[{partId:'part_a',selectable:false}],
 variants:[{variantId:'variant_a',colorIds:['black','pink'],selectable:false,canAutoPublish:false}],
 colors:ids.map(colorId=>({colorId,...(colorId==='black'?{name:'黑色'}:{displayName:colorId}),displayHex:null})),
 options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 while(['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'].reduce((n,s)=>n+x[s].length,0)<197)x.issues.push({issueId:'issue_'+x.issues.length});
 return x;
}
test('nine color families have complete Taiwan Traditional Chinese display labels',()=>{
 const before=fixture(),snapshot=JSON.stringify(before),out=applyTw05ColorLabels(before);
 assert.equal(out.colors.length,9);
 assert(out.colors.every(c=>c.displayNameZhTW===c.displayName&&c.colorMeaning==='search_color_family_only'));
 assert.equal(out.colors.find(c=>c.colorId==='black').displayName,'黑色');
 assert(out.colors.find(c=>c.colorId==='black').aliases.includes('Black'));
 assert.equal(JSON.stringify(before),snapshot);
});
test('visual color candidates do not become verified official shades or hex codes',()=>{
 const out=applyTw05ColorLabels(fixture());
 assert(out.colors.every(c=>c.manufacturerColorNumber===null&&c.physicalColorVerified===false&&c.displayHex===null));
 assert.deepEqual(out.variants[0].colorFamilyLabelsZhTW,['黑色','桃紅色']);
 assert.equal(out.variants[0].manufacturerColorVerified,false);
 assert.equal(out.variants[0].selectable,false);
 assert.equal(out.tw05ColorReview.officialPhysicalColorVerified,0);
});
test('TW-05 retains 197 entities and never publishes',()=>{
 const out=applyTw05ColorLabels(fixture());
 const keys=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
 assert.equal(keys.reduce((n,s)=>n+out[s].length,0),197);
 assert.equal(out.batchId,'DATA-01B-20261009-ZHTW-TW05');
 assert.equal(out.productionWritable,false);assert.equal(out.autoPublish,false);
});
test('missing and foreign color references are blocked',()=>{
 const bad=fixture();bad.variants[0].colorIds.push('magenta_unsupported');
 assert.throws(()=>applyTw05ColorLabels(bad),/TW05_VARIANT_COLOR_REFERENCE_INVALID/);
 const missing=fixture();missing.colors.pop();
 assert.throws(()=>applyTw05ColorLabels(missing),/TW05_EXPECTED_NINE_COLOR_FAMILIES/);
});
test('wrong input revision or production-writable payload rejected',()=>{
 const bad=fixture();bad.batchId='DATA-01B-20261009';
 assert.throws(()=>applyTw05ColorLabels(bad),/TW05_TW04_RESEARCH_INPUT_REQUIRED/);
 const writable=fixture();writable.productionWritable=true;
 assert.throws(()=>applyTw05ColorLabels(writable),/TW05_TW04_RESEARCH_INPUT_REQUIRED/);
});
