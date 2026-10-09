'use strict';
/**
 * DB-01 acceptance receipt verifier. A real Emulator run must produce all four
 * stages; a generic safety CI, synthetic fixture, or offline preflight is not
 * sufficient evidence. This script only checks a supplied log; it does not
 * claim the run was executed or authenticate the log's origin.
 */
const fs=require('node:fs');
const EXPECTED_BATCH='DATA-01B-20261009';
function verifyReceiptText(raw){
 if(typeof raw!=='string'||raw.length>4_000_000)throw Error('DB01_RECEIPT_TEXT_INVALID');
 const rows=[];
 for(const line of raw.split(/\r?\n/)){
  const trimmed=line.trim();
  if(!trimmed.startsWith('{')||!trimmed.endsWith('}'))continue;
  try{const data=JSON.parse(trimmed);if(data&&typeof data==='object'&&!Array.isArray(data))rows.push(data);}
  catch(_){/* non-JSON console output is not an acceptance receipt */}
 }
 const interrupted=rows.filter(x=>x.stage==='interrupted');
 const recovered=rows.filter(x=>x.stage==='recovered');
 const replayed=rows.filter(x=>x.stage==='replayed');
 const final=rows.filter(x=>x.batchId===EXPECTED_BATCH&&x.verifiedDocuments!==undefined);
 if([interrupted,recovered,replayed,final].some(x=>x.length!==1))throw Error('DB01_RECEIPT_STAGES_MISSING_OR_DUPLICATE');
 const [a,b,c,d]=[interrupted[0],recovered[0],replayed[0],final[0]];
 if(a.persistedDocuments!==73||b.inserted!==124||b.unchanged!==73||b.conflicts!==0||
    c.inserted!==0||c.unchanged!==197||c.conflicts!==0||
    d.records!==197||d.firstPartial!==73||d.recovered!==124||
    d.replayUnchanged!==197||d.verifiedDocuments!==197||d.verifiedCollections!==9||
    d.manualConflicts!==1||d.manualCorrectionPreserved!==true||
    d.published!==0||d.cloudWrites!==0||d.emulator!==true)
  throw Error('DB01_RECEIPT_ACCEPTANCE_MISMATCH');
 const indices=[a,b,c,d].map(x=>rows.indexOf(x));
 if(indices.some((x,i)=>i>0&&x<=indices[i-1]))throw Error('DB01_RECEIPT_STAGE_ORDER_INVALID');
 return Object.freeze({batchId:d.batchId,verifiedDocuments:197,verifiedCollections:9,
  interrupted:73,recovered:124,replayUnchanged:197,manualConflicts:1,
  manualCorrectionPreserved:true,published:0,cloudWrites:0,emulator:true});
}
if(require.main===module){
 try{
  const file=process.argv[2];
  if(!file)throw Error('DB01_RECEIPT_FILE_REQUIRED');
  const result=verifyReceiptText(fs.readFileSync(file,'utf8'));
  console.log(JSON.stringify({acceptance:'PASS',...result}));
 }catch(e){console.error('DB01_RECEIPT_FAILED:',e.message);process.exitCode=1;}
}
module.exports={verifyReceiptText};
