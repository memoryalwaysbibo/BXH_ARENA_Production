'use strict';
/** Trusted server-side private fixture + consistent Emulator snapshot loader.
 * No Firebase initialization, request-supplied paths, writes or production support.
 */
const fs=require('node:fs'),crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {planStaging}=require('./catalog-staging.cjs');
const {deriveTaiwanTw04}=require('./catalog-tw04-corrections.cjs');
const {applyTw05ColorLabels}=require('./catalog-tw05-colors.cjs');
const PROJECT='demo-bxh-catalog-db01',HOST='127.0.0.1:8189';
const SHA='2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42';
const MANIFEST='e8fa4337fa76bd13ebc372ff91e611d03fcd4ccd5ec91623be21f5dabc5992f0';
const SECTIONS={sources:['beySources','sourceId',23],products:['beyProducts','productId',9],parts:['beyParts','partId',45],variants:['beyPartVariants','variantId',11],colors:['beyColors','colorId',9],options:['beyProductOptions','optionId',14],assemblyClaims:['beyAssemblyClaims','groupId',16],contentClaims:['beyPackageContents','contentClaimId',52],issues:['beyCatalogIssues','issueId',18]};
function fail(code){throw Error('DATA01B_LOADER_'+code);}
function check(db,target){
 if(target?.mode!=='emulator'||target.projectId!==PROJECT||target.emulatorHost!==HOST||
    process.env.FIRESTORE_EMULATOR_HOST!==HOST||db?.projectId!==PROJECT||
    typeof db.collection!=='function'||typeof db.runTransaction!=='function')fail('LOCAL_EMULATOR_REQUIRED');
}
function fixture(file){
 if(typeof file!=='string'||!file)fail('PRIVATE_FILE_REQUIRED');
 let raw;try{raw=fs.readFileSync(file);}catch{fail('PRIVATE_FILE_UNAVAILABLE');}
 if(crypto.createHash('sha256').update(raw).digest('hex')!==SHA)fail('SOURCE_SHA_MISMATCH');
 const base=JSON.parse(raw);
 if(base.batchId!=='DATA-01B-20261009'||base.productionWritable!==false||base.autoPublish!==false)fail('SOURCE_METADATA_MISMATCH');
 for(const [section,[,,count]] of Object.entries(SECTIONS))if(base[section]?.length!==count)fail('SOURCE_COUNT_MISMATCH');
 const plan=planStaging(base);
 const manifest=crypto.createHash('sha256').update(JSON.stringify(plan.records.map(r=>[r.collection,r.id,r.sha256]))).digest('hex');
 if(plan.recordCount!==197||manifest!==MANIFEST)fail('MANIFEST_MISMATCH');
 return {base,plan};
}
function createData01bEmulatorLoader({db,target,fixtureFile}={}){
 check(db,target);fixture(fixtureFile);
 async function loadOriginal(){
  check(db,target);
  const {base,plan}=fixture(fixtureFile);
  return db.runTransaction(async tx=>{
   const run=await tx.get(db.collection('beyCatalogImportRuns').doc(base.batchId));
   const state=run.exists?run.data():null;
   if(!state||state.manifestDigest!==MANIFEST||state.expectedRecords!==197||state.status!=='completed'||
      state.conflicts!==0||state.origin!=='research_staging'||state.publicationStatus!=='unpublished')fail('BATCH_NOT_VERIFIED');
   const stored=structuredClone(base);
   for(const [section,[collection,idKey,count]] of Object.entries(SECTIONS)){
    const snaps=await tx.get(db.collection(collection));
    if(snaps.size!==count)fail('COLLECTION_COUNT_MISMATCH');
    const docs=new Map(snaps.docs.map(d=>[d.id,d.data()]));
    const hashes=new Map(plan.records.filter(r=>r.collection===collection).map(r=>[r.id,r.sha256]));
    stored[section]=base[section].map(original=>{
     const id=original[idKey],saved=docs.get(id);
     const expected={sha256:hashes.get(id),batchId:base.batchId,origin:'research_staging',publicationStatus:'unpublished',payload:original};
     if(!isDeepStrictEqual(saved,expected))fail('DOCUMENT_MISMATCH');
     return saved.payload;
    });
   }
   return stored;
  },{readOnly:true});
 }
 async function loadResearchBatch(){
  return applyTw05ColorLabels(deriveTaiwanTw04(await loadOriginal()));
 }
 return Object.freeze({loadOriginal,loadResearchBatch,emulatorOnly:true,readOnly:true});
}
module.exports={createData01bEmulatorLoader};
