'use strict';
/**
 * TW-05: normalize color-family search labels without claiming verified paint,
 * finish, physical transparency or manufacturer's official color number.
 * Input is the derived TW-04 batch; original research is never mutated.
 */
const COLOR_FAMILIES=Object.freeze({
 black:{label:'黑色',aliases:['黑','Black']},
 yellow_green:{label:'黃綠色',aliases:['黃綠','Yellow Green']},
 white:{label:'白色',aliases:['白','White']},
 teal:{label:'青綠色',aliases:['青綠','Teal']},
 blue:{label:'藍色',aliases:['藍','Blue']},
 yellow:{label:'黃色',aliases:['黃','Yellow']},
 pink:{label:'桃紅色',aliases:['桃紅','Pink']},
 silver:{label:'銀色',aliases:['銀','Silver']},
 purple:{label:'紫色',aliases:['紫','Purple']}
});
const ENTITY_SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function applyTw05ColorLabels(tw04){
 if(!tw04||tw04.batchId!=='DATA-01B-20261009-ZHTW-TW04'||tw04.productionWritable!==false||tw04.autoPublish!==false)throw Error('TW05_TW04_RESEARCH_INPUT_REQUIRED');
 if(!Array.isArray(tw04.colors)||!Array.isArray(tw04.variants)||!Array.isArray(tw04.parts))throw Error('TW05_MISSING_COLLECTION');
 const out=structuredClone(tw04);
 if(out.colors.length!==Object.keys(COLOR_FAMILIES).length)throw Error('TW05_EXPECTED_NINE_COLOR_FAMILIES');
 const seen=new Set();
 for(const c of out.colors){
  if(seen.has(c.colorId)||!Object.hasOwn(COLOR_FAMILIES,c.colorId))throw Error('TW05_UNKNOWN_OR_DUPLICATE_COLOR');
  seen.add(c.colorId);
  const spec=COLOR_FAMILIES[c.colorId];
  const oldNames=[c.displayName,c.name,...(c.aliases||[])].filter(x=>typeof x==='string'&&x.trim());
  c.displayName=spec.label;c.displayNameZhTW=spec.label;
  c.aliases=[...new Set([spec.label,...spec.aliases,...oldNames])];
  c.colorMeaning='search_color_family_only';
  c.manufacturerColorNumber=null;
  c.physicalColorVerified=false;
  c.displayHex=null; // Do not fabricate exact swatches for visually estimated colors.
  c.localizationStatus='taiwan_search_color_family';
 }
 for(const v of out.variants){
  if(!Array.isArray(v.colorIds)||v.colorIds.some(id=>!seen.has(id)))throw Error('TW05_VARIANT_COLOR_REFERENCE_INVALID');
  v.colorFamilyLabelsZhTW=v.colorIds.map(id=>COLOR_FAMILIES[id].label);
  v.colorFamilyOnly=true;
  v.manufacturerColorVerified=false;
  v.canAutoPublish=false;
  v.selectable=false;
 }
 for(const p of out.parts)p.selectable=false;
 if(ENTITY_SECTIONS.reduce((n,s)=>n+(Array.isArray(out[s])?out[s].length:0),0)!==197)throw Error('TW05_RECORD_COUNT_CHANGED');
 out.batchId='DATA-01B-20261009-ZHTW-TW05';
 out.batchRevision=7;out.localizationRevision=5;
 out.tw05ColorReview={colorFamilies:out.colors.length,variantCandidates:out.variants.length,officialPhysicalColorVerified:0,autoPublished:0,meaning:'search_family_not_official_shade'};
 out.productionWritable=false;out.autoPublish=false;
 return out;
}
module.exports={COLOR_FAMILIES,applyTw05ColorLabels};
