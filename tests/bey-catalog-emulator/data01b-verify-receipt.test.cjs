'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {verifyReceiptText}=require('./data01b-verify-receipt.cjs');
function stages(){
 return [
 {stage:'interrupted',persistedDocuments:73},
 {stage:'recovered',inserted:124,unchanged:73,conflicts:0,deleted:0,published:0},
 {stage:'replayed',inserted:0,unchanged:197,conflicts:0,deleted:0,published:0},
 {batchId:'DATA-01B-20261009',sourceSha256:'2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42',
  manifestDigest:'e8fa4337fa76bd13ebc372ff91e611d03fcd4ccd5ec91623be21f5dabc5992f0',records:197,firstPartial:73,recovered:124,
  replayUnchanged:197,verifiedDocuments:197,verifiedCollections:9,
  manualConflicts:1,manualCorrectionPreserved:true,published:0,cloudWrites:0,emulator:true}
 ];
}
const log=arr=>arr.map(x=>JSON.stringify(x)).join('\n')+'\n';
test('all four actual Emulator acceptance stages are required in order',()=>{
 const result=verifyReceiptText(log(stages()));
 assert.equal(result.verifiedDocuments,197);
 assert.equal(result.manualCorrectionPreserved,true);
 assert.equal(result.cloudWrites,0);
});
test('synthetic, preflight-only, and ordinary Emulator safety logs never qualify',()=>{
 for(const raw of ['PREFLIGHT_ONLY: PASS','{"preflight":"PASS","records":197}',JSON.stringify({verifiedDocuments:197})])
  assert.throws(()=>verifyReceiptText(raw),/DB01_RECEIPT_STAGES_MISSING_OR_DUPLICATE/);
});
test('reject missing or duplicate stages, or out-of-order events',()=>{
 const s=stages();
 assert.throws(()=>verifyReceiptText(log(s.slice(1))),/DB01_RECEIPT_STAGES_MISSING_OR_DUPLICATE/);
 assert.throws(()=>verifyReceiptText(log([...s,s[0]])),/DB01_RECEIPT_STAGES_MISSING_OR_DUPLICATE/);
 assert.throws(()=>verifyReceiptText(log([s[2],s[1],s[0],s[3]])),/DB01_RECEIPT_STAGE_ORDER_INVALID/);
});
test('all final acceptance invariants fail closed',()=>{
 const s=stages();
 for(const [key,value] of Object.entries({
  batchId:'OTHER',sourceSha256:'bad',manifestDigest:'bad',records:196,firstPartial:72,recovered:123,
  replayUnchanged:196,verifiedDocuments:196,verifiedCollections:8,
  manualConflicts:0,manualCorrectionPreserved:false,published:1,cloudWrites:1,emulator:false
 })){
  const changed=structuredClone(s);changed[3][key]=value;
  assert.throws(()=>verifyReceiptText(log(changed)),/DB01_RECEIPT_(?:STAGES_MISSING_OR_DUPLICATE|ACCEPTANCE_MISMATCH)/,key);
 }
});
test('partial recovery and replay values must be exact',()=>{
 for(const [stage,key,value] of [[0,'persistedDocuments',74],[1,'inserted',125],
  [1,'unchanged',72],[1,'conflicts',1],[2,'inserted',1],[2,'unchanged',196],[2,'conflicts',1]]){
  const s=stages();s[stage][key]=value;
  assert.throws(()=>verifyReceiptText(log(s)),/DB01_RECEIPT_ACCEPTANCE_MISMATCH/);
 }
});
test('ignore unrelated Firebase logs but reject invalid types and oversized input',()=>{
 const raw='Firebase Emulator started\n'+log(stages())+'Emulator shutdown\n';
 assert.equal(verifyReceiptText(raw).emulator,true);
 assert.throws(()=>verifyReceiptText(null),/DB01_RECEIPT_TEXT_INVALID/);
 assert.throws(()=>verifyReceiptText('x'.repeat(4_000_001)),/DB01_RECEIPT_TEXT_INVALID/);
});

test('receipt is rejected when original source or manifest hash is absent or changed',()=>{
 for(const key of ['sourceSha256','manifestDigest']){
  const missing=stages();delete missing[3][key];
  assert.throws(()=>verifyReceiptText(log(missing)),/DB01_RECEIPT_ACCEPTANCE_MISMATCH/,key);
  const forged=stages();forged[3][key]='f'.repeat(64);
  assert.throws(()=>verifyReceiptText(log(forged)),/DB01_RECEIPT_ACCEPTANCE_MISMATCH/,key);
 }
});
