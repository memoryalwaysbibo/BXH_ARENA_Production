'use strict';
/**
 * DB-01 real fixture preflight. No Firebase SDK, network, or production writes.
 * The fixture must be injected privately; never commit catalog-research.json.
 */
const fs=require('node:fs');
const crypto=require('node:crypto');
const {planStaging}=require('../../modules/bey-catalog/catalog-staging.cjs');
const EXPECTED_SHA256='2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42';
const EXPECTED_MANIFEST='e8fa4337fa76bd13ebc372ff91e611d03fcd4ccd5ec91623be21f5dabc5992f0';
const EXPECTED_COUNTS=Object.freeze({
 sources:23,products:9,parts:45,variants:11,colors:9,options:14,assemblyClaims:16,contentClaims:52,issues:18
});
function sha(v){return crypto.createHash('sha256').update(v).digest('hex');}
function verifyData01bRaw(raw){
 if(!Buffer.isBuffer(raw))throw Error('DATA01B_RAW_BUFFER_REQUIRED');
 if(sha(raw)!==EXPECTED_SHA256)throw Error('DATA01B_SHA256_MISMATCH');
 const batch=JSON.parse(raw.toString('utf8'));
 if(batch.batchId!=='DATA-01B-20261009'||batch.dataOrigin!=='source-tiered-research'||
    batch.productionWritable!==false||batch.autoPublish!==false)
  throw Error('DATA01B_METADATA_MISMATCH');
 for(const [key,count] of Object.entries(EXPECTED_COUNTS))
  if(!Array.isArray(batch[key])||batch[key].length!==count)
   throw Error('DATA01B_SECTION_COUNT_MISMATCH:'+key);
 const plan=planStaging(batch);
 if(plan.recordCount!==197||plan.records.length!==197||plan.mode!=='DRY_RUN'||
    plan.productionWritable!==false||plan.autoPublish!==false)
  throw Error('DATA01B_UNSAFE_PLAN');
 const ids=new Set();
 for(const r of plan.records){
  const key=r.collection+'/'+r.id;
  if(ids.has(key)||!r.sha256||r.reviewState!=='research_only')
   throw Error('DATA01B_DUPLICATE_OR_UNSAFE_RECORD');
  ids.add(key);
 }
 const manifest=sha(Buffer.from(JSON.stringify(plan.records.map(r=>[r.collection,r.id,r.sha256]))));
 if(manifest!==EXPECTED_MANIFEST)throw Error('DATA01B_MANIFEST_MISMATCH');
 return {batch,plan,summary:Object.freeze({batchId:batch.batchId,records:197,
  collections:new Set(plan.records.map(r=>r.collection)).size,sha256:EXPECTED_SHA256,
  manifestDigest:manifest,productionWritable:false,autoPublish:false})};
}
function verifyData01bFile(filename){
 if(typeof filename!=='string'||!filename)throw Error('DATA01B_FILE_REQUIRED');
 return verifyData01bRaw(fs.readFileSync(filename));
}
if(require.main===module){
 try{
  const {summary}=verifyData01bFile(process.env.BXH_CATALOG_DATA01B_FILE);
  console.log(JSON.stringify({preflight:'PASS',...summary}));
 }catch(e){console.error('DATA01B_PREFLIGHT_FAILED:',e.message);process.exitCode=1;}
}
module.exports={verifyData01bRaw,verifyData01bFile,EXPECTED_SHA256,EXPECTED_MANIFEST,EXPECTED_COUNTS};
