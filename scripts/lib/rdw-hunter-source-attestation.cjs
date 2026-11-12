'use strict';
// Source-code attestation for the audited Hunter Reader candidate.
// This DOES NOT attest a deployed runtime by itself. A trusted operator must
// independently obtain the live function source generation and match its bytes.
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join,resolve,sep}=require('node:path');
const SOURCE=Object.freeze({
 repository:'memoryalwaysbibo/BXH_ARENA_Functions_Production',
 directory:'release/hunter-license-v21',
 ruleVersion:'hunter-license-v2.1',
 candidateGitBlobs:Object.freeze({
  'reader.cjs':'4d21a650585f21a55a04759c8894c4021989ceb4',
  'service.cjs':'3f36b74e738c3df5ee90c6fc68c262d45cf9ca4b',
  'callable.cjs':'56ddd7e4eb4f26d6fdd8dc22b21628eb6f51cb6d',
  'evaluator.cjs':'d444ad3b5c78d1f5400ffbf7f62ced9296769e9e',
  'vendor/provenance.json':'55e3a2080ac8f96cd3c34c7e84cc8406c758d162'
 })
});
function gitBlobHash(bytes){
 const buf=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 const head=Buffer.from('blob '+buf.length+'\\0');
 return createHash('sha1').update(head).update(buf).digest('hex');
}
function verifyCandidate({files,liveGeneration,expectedLiveGeneration}={}){
 // NEVER infer deployed identity from a Git branch or previous source ZIP.
 if(typeof liveGeneration!=='string'||!/^[0-9]{10,}$/.test(liveGeneration)||
    !expectedLiveGeneration||liveGeneration!==String(expectedLiveGeneration))
  return {ok:false,reason:'live-deployment-not-attested'};
 if(!files||typeof files!=='object')return {ok:false,reason:'candidate-files-required'};
 for(const [name,expected] of Object.entries(SOURCE.candidateGitBlobs)){
  if(!Object.hasOwn(files,name))return {ok:false,reason:'candidate-file-missing',file:name};
  const actual=gitBlobHash(files[name]);
  if(actual!==expected)return {ok:false,reason:'candidate-source-mismatch',file:name};
 }
 // This covers five core file blobs only, not the complete transitive vendor
 // closure. Remaining dependencies must be checked before using any reader.
 return {ok:true,scope:'partial-source-fingerprint-only',generation:liveGeneration};
}
module.exports={SOURCE,gitBlobHash,verifyCandidate};
