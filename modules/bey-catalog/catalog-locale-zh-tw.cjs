'use strict';
/** Taiwan Traditional Chinese display layer; no database writes or source mutation. */
const PRODUCT_NAMES=Object.freeze({'UX-03':'魔導神杖 5-70DB','UX-19':'彈丸獅鷲 H','UX-20':'榮耀武神 LF','CX-07':'天馬爆擊 ATr','CX-13':'龍王閃擊 BK1-50I','UX-18':'隨機強化組 Vol.8','BX-01':'蒼龍神劍 3-60F','BX-20':'蒼龍利刃改造組','CX-00':'蒼龍鎖定紋章・透明黑版特典'});
const PART_NAMES=Object.freeze({part_000001:'魔導神杖',part_000004:'彈丸獅鷲',part_000006:'榮耀武神',part_000008:'古屍詛咒',part_000011:'蒼龍神劍',part_000014:'蒼龍利刃',part_000017:'鮫鯊鋒鰭',part_000019:'騎士重盾',part_000022:'蒼龍鎖定紋章',part_000023:'天馬',part_000024:'爆擊',part_000025:'A',part_000027:'龍王',part_000028:'閃擊',part_000029:'B',part_000030:'K',part_000034:'Brush（台灣名稱待核）',part_000035:'M',part_000037:'Sol（台灣名稱待核）',part_000038:'勇氣',part_000039:'C',part_000043:'皓戰猛虎'});
const GROUP_NAMES=Object.freeze(['魔導神杖 5-70DB','彈丸獅鷲 H','榮耀武神 LF','天馬爆擊 ATr','龍王閃擊 BK1-50I','古屍詛咒 7-55W','古屍詛咒 4-60C','天馬 Brush M3-85W（台灣名稱待核）','Sol Brave C9-70TP（台灣名稱待核）','蒼龍利刃 7-55G','皓戰猛虎 4-80LR','蒼龍神劍 3-60F','蒼龍利刃 4-60R','鮫鯊鋒鰭 3-80F（台灣資料；原始零件待核對）','騎士重盾 5-80T','蒼龍鎖定紋章・透明黑版']);
const VARIANT_NAMES=Object.freeze(['蒼龍鎖定紋章・透明黑版','天馬｜CX-07 圖示版本','爆擊｜CX-07 圖示版本','A｜CX-07 圖示版本','Tr｜CX-07 圖示版本','龍王｜CX-13 圖示版本','B｜CX-13 圖示版本','閃擊｜CX-13 圖示版本','K｜CX-13 圖示版本','1-50｜產品與配色歸屬待核對','I｜CX-13 圖示版本']);
const TAIWAN_CORRECTION_CANDIDATES=Object.freeze({
 'assemblyClaims:group_000014':Object.freeze({
  sourceProduct:'BX-20',taiwanStockNotation:'鮫鯊鋒鰭 3-80F',
  existingResearchNotation:'鮫鯊鋒鰭 3-80LF',
  candidateBit:'F',status:'pending_source_bom_reconciliation',
  evidenceUrls:['https://beyblade.phstudy.org/p/zh-TW/Series/SR-PRD-913078-02.html','https://beybladehub.app/parts/combos/BX-20'],
  instruction:'Do not silently replace the underlying contentClaim bit or mark verified.'
 }),
 'variants:variant_000010':Object.freeze({
  existingAssociation:'CX-07',suspectedStockSource:'CX-13',
  status:'pending_color_variant_provenance_recheck',
  evidenceUrls:['https://www.takaratomy.co.jp/support/manual/beyblade/2025072315321.html','https://cdn.takaratomy.co.jp/support/manual/beyblade/2026040215816.html'],
  instruction:'Do not reassign variant product or color until the physical color edition is confirmed.'
 })
});
const USER_ALIASES=Object.freeze({'UX-19':['子彈獅鷲 H'],'UX-20':['榮耀女武神 LF']});
const NEEDS_REVIEW=Object.freeze({'products:product_000009':'provisional_translation','variants:variant_000010':'needs_source_recheck','assemblyClaims:group_000014':'needs_original_kit_recheck','parts:part_000022':'provisional_translation','parts:part_000034':'taiwan_name_pending','parts:part_000037':'taiwan_name_pending','assemblyClaims:group_000008':'taiwan_name_pending_supplier_source','assemblyClaims:group_000009':'taiwan_name_pending_supplier_source'});
function nameFor(section,record){
 if(section==='products')return PRODUCT_NAMES[record.productCode];
 if(section==='parts')return PART_NAMES[record.partId]||record.displayName;
 if(section==='variants')return VARIANT_NAMES[Number(record.variantId.split('_').pop())-1];
 if(section==='assemblyClaims')return GROUP_NAMES[Number(record.groupId.split('_').pop())-1];
 return undefined;
}
function localizeRecord(section,record){
 if(!record||typeof record!=='object')throw Error('INVALID_CATALOG_RECORD');
 const name=nameFor(section,record);
 if(!name)return {...record};
 const id=record.productId||record.partId||record.variantId||record.groupId;
 const aliases=[...(Array.isArray(record.aliases)?record.aliases:[])];
 for(const alias of [record.displayName,name,...(section==='products'?(USER_ALIASES[record.productCode]||[]):[])]){
  if(alias&&!aliases.includes(alias))aliases.push(alias);
 }
 return {...record,displayName:name,displayNameZhTW:name,displayNameBeforeLocalization:record.displayName,
  localizationStatus:NEEDS_REVIEW[section+':'+id]||(section==='parts'&&!PART_NAMES[id]?'unchanged_part_code':'taiwan_community_attested'),
  ...(section==='products'||section==='parts'?{aliases}:{})};
}
function localizeCatalog(batch){
 if(!batch||batch.productionWritable!==false||batch.autoPublish!==false)throw Error('RESEARCH_ONLY_LOCALIZATION');
 const out={...batch,locale:'zh-TW',localizationRevision:1,sourceBatchId:batch.batchId,productionWritable:false,autoPublish:false};
 for(const section of ['products','parts','variants','assemblyClaims']){
  if(!Array.isArray(batch[section]))throw Error('MISSING_SECTION_'+section);
  out[section]=batch[section].map(x=>localizeRecord(section,x));
 }
 return out;
}
module.exports={PRODUCT_NAMES,PART_NAMES,GROUP_NAMES,VARIANT_NAMES,TAIWAN_CORRECTION_CANDIDATES,localizeRecord,localizeCatalog};
