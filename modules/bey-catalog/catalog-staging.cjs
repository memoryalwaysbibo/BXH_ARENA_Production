'use strict';
const crypto=require('node:crypto');
const SECTIONS=Object.freeze({sources:['beySources','sourceId'],products:['beyProducts','productId'],parts:['beyParts','partId'],variants:['beyPartVariants','variantId'],colors:['beyColors','colorId'],options:['beyProductOptions','optionId'],assemblyClaims:['beyAssemblyClaims','groupId'],contentClaims:['beyPackageContents','contentClaimId'],issues:['beyCatalogIssues','issueId']});
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
function digest(v){return crypto.createHash('sha256').update(stable(v)).digest('hex');}
function assert(ok,msg){if(!ok)throw Error(msg);}
function planStaging(batch){
 assert(batch&&batch.dataOrigin==='source-tiered-research'&&batch.productionWritable===false&&batch.autoPublish===false,'UNSAFE_BATCH');
 assert(typeof batch.batchId==='string'&&batch.batchId.length>3,'MISSING_BATCH_ID');
 const ids={};for(const [section,[collection,key]] of Object.entries(SECTIONS)){
  const list=batch[section];assert(Array.isArray(list),'MISSING_'+section);
  ids[section]=new Set();for(const item of list){assert(item&&typeof item[key]==='string'&&/^[a-zA-Z0-9_-]+$/.test(item[key]),'INVALID_ID_'+section);assert(!ids[section].has(item[key]),'DUPLICATE_ID_'+section);ids[section].add(item[key]);}
 }
 const has=(section,id)=>id==null||ids[section].has(id);
 for(const s of batch.sources)assert(s.url?.startsWith('https://')&&s.automatedAccess==='not_enabled','UNAPPROVED_SOURCE');
 for(const p of batch.products)assert(has('sources',p.sourceId),'PRODUCT_SOURCE_MISSING');
 for(const v of batch.variants)assert(has('parts',v.partId),'VARIANT_PART_MISSING');
 for(const o of batch.options)assert(has('products',o.productId),'OPTION_PRODUCT_MISSING');
 for(const a of batch.assemblyClaims)assert(has('products',a.productId)&&has('options',a.optionId),'ASSEMBLY_REFERENCE_MISSING');
 for(const c of batch.contentClaims){assert(has('products',c.productId)&&has('options',c.optionId)&&has('assemblyClaims',c.groupId)&&has('parts',c.partId)&&has('variants',c.variantId),'CONTENT_REFERENCE_MISSING');if(c.variantId){const variant=batch.variants.find(v=>v.variantId===c.variantId);assert(variant.partId===c.partId,'VARIANT_PART_MISMATCH');}}
 for(const i of batch.issues)assert(has('products',i.productId),'ISSUE_PRODUCT_MISSING');
 const records=[];for(const [section,[collection,key]] of Object.entries(SECTIONS))for(const item of batch[section])records.push(Object.freeze({collection,id:item[key],sha256:digest(item),data:item,reviewState:'research_only'}));
 return Object.freeze({batchId:batch.batchId,mode:'DRY_RUN',productionWritable:false,autoPublish:false,recordCount:records.length,records});
}
/** Adapter has get(collection,id) and put(collection,id,document); no Firebase SDK or network calls. */
async function applyEmulatorStaging(plan,adapter,target){
 assert(target?.mode==='emulator'&&target?.readOnlyProduction===true&&/^demo-/.test(target.projectId),'TARGET_NOT_ISOLATED');
 assert(plan?.mode==='DRY_RUN'&&plan.productionWritable===false&&plan.autoPublish===false,'PLAN_NOT_SAFE');
 assert(adapter&&typeof adapter.get==='function'&&typeof adapter.put==='function','ADAPTER_REQUIRED');
 let inserted=0,unchanged=0,conflicts=0;
 for(const r of plan.records){const old=await adapter.get(r.collection,r.id);if(old){if(old.sha256===r.sha256)unchanged++;else conflicts++;continue;}
 await adapter.put(r.collection,r.id,{sha256:r.sha256,origin:'research_staging',batchId:plan.batchId,payload:r.data,publicationStatus:'unpublished'});inserted++;}
 return {inserted,unchanged,conflicts,deleted:0,published:0};
}
module.exports={planStaging,applyEmulatorStaging};