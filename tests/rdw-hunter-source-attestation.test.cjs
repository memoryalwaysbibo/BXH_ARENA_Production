'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SOURCE,gitBlobHash,verifyCandidate}=require('../scripts/lib/rdw-hunter-source-attestation.cjs');
test('Git blob hash uses canonical bytes and NUL header',()=>{
 assert.equal(gitBlobHash(Buffer.from('hello\n')),'ce013625030ba8dba906f756967f9e9ca394464a');
});
test('missing or outdated live generation fails closed',()=>{
 const files={};
 for(const name of Object.keys(SOURCE.candidateGitBlobs))files[name]='synthetic';
 for(const input of [
  {files},{files,liveGeneration:'1793514800599572'},
  {files,liveGeneration:'1793514800599572',expectedLiveGeneration:'1792487233621570'},
  {files,liveGeneration:'not-a-generation',expectedLiveGeneration:'not-a-generation'}
 ]){
  const result=verifyCandidate(input);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'live-deployment-not-attested');
 }
});
test('missing and mismatched source files cannot pass provenance gate',()=>{
 const liveGeneration='1793514800599572';
 const input={liveGeneration,expectedLiveGeneration:liveGeneration};
 const missing=verifyCandidate({...input,files:{}});
 assert.equal(missing.ok,false);
 assert.equal(missing.reason,'candidate-file-missing');
 const files=Object.fromEntries(Object.keys(SOURCE.candidateGitBlobs).map(name=>[name,Buffer.from('fake')]));
 const mismatch=verifyCandidate({...input,files});
 assert.equal(mismatch.ok,false);
 assert.equal(mismatch.reason,'candidate-source-mismatch');
 assert.equal(mismatch.file,'reader.cjs');
});
test('source scope identifies candidate backend only, not deployment proof',()=>{
 assert.equal(SOURCE.repository,'memoryalwaysbibo/BXH_ARENA_Functions_Production');
 assert.equal(SOURCE.ruleVersion,'hunter-license-v2.1');
 assert.equal(Object.keys(SOURCE.candidateGitBlobs).length,12);
 for(const name of ['reader.cjs','service.cjs','evaluator.cjs','recovery-window.cjs','vendor/identity-service.cjs','vendor/canonical.js'])
  assert.ok(SOURCE.candidateGitBlobs[name]);
});
