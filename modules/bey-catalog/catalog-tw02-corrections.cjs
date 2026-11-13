'use strict';
/**
 * TW-02: source-evidenced corrections on a COPY of the Taiwan-localized research batch.
 * The original DATA-01B fixture is immutable and remains the DB-01 Emulator acceptance input.
 */
const {localizeCatalog}=require('./catalog-locale-zh-tw.cjs');
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function one(items,key,value){
 const matches=items.filter(x=>x[key]===value);
 if(matches.length!==1)throw Error('TW02_EXPECTED_UNIQUE_'+value);
 return matches[0];
}
function buildTaiwanTw02(base){
 if(!base||base.batchId!=='DATA-01B-20261009'||base.productionWritable!==false||base.autoPublish!==false)throw Error('TW02_UNEXPECTED_BASE');
 if(SECTIONS.reduce((n,s)=>n+(Array.isArray(base[s])?base[s].length:0),0)!==197)throw Error('TW02_EXPECTED_197');
 const src=one(base.sources,'sourceId','tt-bx20-manual');
 if(src.authority!=='manufacturer'||src.url!=='https://beyblade.takaratomy.co.jp/beyblade-x/manual/BX-20_manual.pdf')throw Error('TW02_OFFICIAL_SOURCE_MISSING');
 const image=one(base.sources,'sourceId','tt-image-cx13_07');
 if(image.authority!=='manufacturer'||!image.url.includes('CX13_07_list.png'))throw Error('TW02_CX13_IMAGE_SOURCE_MISSING');
 const output=localizeCatalog(base);
 // No mutation of the original base, including nested evidence or aliases.
 const result=structuredClone(output);
 const group=one(result.assemblyClaims,'groupId','group_000014');
 const content=one(result.contentClaims,'contentClaimId','content_000019');
 if(group.productId!=='product_000008'||content.productId!=='product_000008'||content.groupId!==group.groupId||content.partId!=='part_000007')throw Error('TW02_ORIGINAL_BOM_CHANGED');
 const oldLF=one(result.parts,'partId','part_000007'),newF=one(result.parts,'partId','part_000013');
 if(oldLF.displayName!=='LF'||newF.displayName!=='F'||newF.category!=='bit')throw Error('TW02_BIT_TYPE_MISMATCH');
 content.partId='part_000013';
 content.dataCorrection={correctionId:'TW02-BX20-001',fromPartId:'part_000007',toPartId:'part_000013',sourceId:'tt-bx20-manual',sourcePage:1,verification:'manufacturer_manual_image_verified',published:false};
 group.displayName='鮫鯊鋒鰭 3-80F';group.displayNameZhTW=group.displayName;
 group.localizationStatus='manufacturer_manual_verified';
 group.dataCorrection={correctionId:'TW02-BX20-001',from:'SharkEdge 3-80LF',to:group.displayName,sourceId:'tt-bx20-manual',sourcePage:1,verification:'manufacturer_manual_image_verified'};
 const variant=one(result.variants,'variantId','variant_000010');
 if(variant.sourceProductId!=='product_000005'||variant.partId!=='part_000031')throw Error('TW02_CX13_SCOPE_CHANGED');
 variant.displayName='1-50｜CX-13 商品圖候選（實物配色待核對）';
 variant.displayNameZhTW=variant.displayName;
 variant.localizationStatus='product_source_verified_color_pending';
 variant.dataCorrection={correctionId:'TW02-CX13-002',incorrectDisplayProduct:'CX-07',verifiedSourceProduct:'CX-13',sourceId:'tt-image-cx13_07',colorVerification:'pending'};
 result.batchId='DATA-01B-20261009-ZHTW-TW02';result.sourceBatchId=base.batchId;
 result.batchRevision=4;result.localizationRevision=2;
 result.tw02Corrections=[
  {id:'TW02-BX20-001',kind:'official_bom_correction',productId:'product_000008',groupId:'group_000014',contentClaimId:'content_000019',oldPartId:'part_000007',newPartId:'part_000013',manualUrl:src.url,page:1,approvedForPublication:false},
  {id:'TW02-CX13-002',kind:'display_source_correction',variantId:'variant_000010',sourceProductId:'product_000005',evidenceUrl:image.url,colorPhysicalVerification:'pending',approvedForPublication:false}
 ];
 result.productionWritable=false;result.autoPublish=false;
 if(SECTIONS.reduce((n,s)=>n+result[s].length,0)!==197)throw Error('TW02_COUNT_CHANGED');
 return result;
}
module.exports={buildTaiwanTw02};
