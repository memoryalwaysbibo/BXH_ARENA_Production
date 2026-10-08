'use strict';
/** Validate an externally supplied DATA-01B research JSON without cloud access. */
const fs=require('node:fs');
const {planStaging}=require('../modules/bey-catalog/catalog-staging.cjs');
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/bey-catalog-verify-research.cjs /path/to/catalog-research.json');
const batch=JSON.parse(fs.readFileSync(file,'utf8'));
const plan=planStaging(batch);
const docs=new Map();
const key=r=>r.collection+'/'+r.id;
let first=0,second=0;
for(const r of plan.records){if(docs.has(key(r)))throw Error('DUPLICATE_RECORD');docs.set(key(r),r.sha256);first++;}
for(const r of plan.records){if(docs.get(key(r))!==r.sha256)throw Error('REPLAY_MISMATCH');second++;}
const partial=new Map(plan.records.slice(0,Math.floor(plan.records.length/3)).map(r=>[key(r),r.sha256]));
let recovered=0,skipped=0;
for(const r of plan.records){if(partial.has(key(r))){if(partial.get(key(r))!==r.sha256)throw Error('PARTIAL_CONFLICT');skipped++;}else{partial.set(key(r),r.sha256);recovered++;}}
if(partial.size!==plan.recordCount)throw Error('RECOVERY_COUNT_MISMATCH');
const summary={batchId:plan.batchId,mode:'LOCAL_SIMULATION_ONLY',recordCount:plan.recordCount,firstInserted:first,replayUnchanged:second,recovered,skipped,publicationCount:0,cloudWrites:0};
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
