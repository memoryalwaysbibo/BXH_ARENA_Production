'use strict';
const crypto=require('node:crypto');
const {assertIsolatedTarget,allowedCollections}=require('./safety-gate.cjs');
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
 const required=(section,id)=>typeof id==='string'&&ids[section].has(id);
 const byOption=new Map(batch.options.map(x=>[x.optionId,x]));
 const byGroup=new Map(batch.assemblyClaims.map(x=>[x.groupId,x]));
 const byVariant=new Map(batch.variants.map(x=>[x.variantId,x]));
 for(const p of batch.products)assert(required('sources',p.sourceId),'PRODUCT_SOURCE_MISSING');
 for(const v of batch.variants){
  assert(required('parts',v.partId),'VARIANT_PART_MISSING');
  if(v.colorIds!=null){assert(Array.isArray(v.colorIds),'VARIANT_COLORS_MALFORMED');for(const id of v.colorIds)assert(required('colors',id),'VARIANT_COLOR_MISSING');}
 }
 for(const o of batch.options)assert(required('products',o.productId),'OPTION_PRODUCT_MISSING');
 for(const a of batch.assemblyClaims){
  assert(required('products',a.productId)&&required('options',a.optionId),'ASSEMBLY_REFERENCE_MISSING');
  assert(byOption.get(a.optionId).productId===a.productId,'ASSEMBLY_OPTION_PRODUCT_MISMATCH');
 }
 for(const c of batch.contentClaims){
  assert(required('products',c.productId)&&required('options',c.optionId)&&required('assemblyClaims',c.groupId)&&required('parts',c.partId)&&has('variants',c.variantId),'CONTENT_REFERENCE_MISSING');
  const group=byGroup.get(c.groupId);
  assert(group.productId===c.productId&&group.optionId===c.optionId,'CONTENT_GROUP_SCOPE_MISMATCH');
  assert(byOption.get(c.optionId).productId===c.productId,'CONTENT_OPTION_PRODUCT_MISMATCH');
  if(c.variantId)assert(byVariant.get(c.variantId).partId===c.partId,'VARIANT_PART_MISMATCH');
 }
 for(const i of batch.issues)assert(required('products',i.productId),'ISSUE_PRODUCT_MISSING');
 for(const section of ['products','parts','variants','assemblyClaims','contentClaims']){
  for(const item of batch[section]){
   if(item.evidence==null)continue;
   assert(Array.isArray(item.evidence),'EVIDENCE_MALFORMED');
   for(const ev of item.evidence)assert(ev&&required('sources',ev.sourceId),'EVIDENCE_SOURCE_MISSING');
  }
 }
 const records=[];for(const [section,[collection,key]] of Object.entries(SECTIONS))for(const item of batch[section])records.push(Object.freeze({collection,id:item[key],sha256:digest(item),data:item,reviewState:'research_only'}));
 return Object.freeze({batchId:batch.batchId,mode:'DRY_RUN',productionWritable:false,autoPublish:false,recordCount:records.length,records});
}
/** Adapter has get(collection,id) and put(collection,id,document); no Firebase SDK or network calls. */
async function applyEmulatorStaging(plan,adapter,target){
 assertIsolatedTarget(target);
 assert(plan?.mode==='DRY_RUN'&&plan.productionWritable===false&&plan.autoPublish===false,'PLAN_NOT_SAFE');
 assert(adapter&&adapter.emulatorOnly===true&&typeof adapter.get==='function'&&typeof adapter.put==='function','EMULATOR_ADAPTER_REQUIRED');
 let inserted=0,unchanged=0,conflicts=0;
 for(const r of plan.records){assert(allowedCollections.includes(r.collection),'COLLECTION_NOT_ALLOWED');const old=await adapter.get(r.collection,r.id);if(old){if(old.sha256===r.sha256)unchanged++;else conflicts++;continue;}
 await adapter.put(r.collection,r.id,{sha256:r.sha256,origin:'research_staging',batchId:plan.batchId,payload:r.data,publicationStatus:'unpublished'});inserted++;}
 return {inserted,unchanged,conflicts,deleted:0,published:0};
}
module.exports={planStaging,applyEmulatorStaging};