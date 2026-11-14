'use strict';
// Source-code attestation for the audited Hunter Reader candidate.
// This DOES NOT attest a deployed runtime by itself. A trusted operator must
// independently obtain the live function source generation and match its bytes.
const {createHash}=require('node:crypto');
const SOURCE=Object.freeze({
 repository:'memoryalwaysbibo/BXH_ARENA_Functions_Production',
 directory:'release/hunter-license-v21',
 ruleVersion:'hunter-license-v2.1',
 candidateGitBlobs:Object.freeze({
  'reader.cjs':'4d21a650585f21a55a04759c8894c4021989ceb4',
  'service.cjs':'3f36b74e738c3df5ee90c6fc68c262d45cf9ca4b',
  'callable.cjs':'56ddd7e4eb4f26d6fdd8dc22b21628eb6f51cb6d',
  'evaluator.cjs':'d444ad3b5c78d1f5400ffbf7f62ced9296769e9e',
  'vendor/provenance.json':'55e3a2080ac8f96cd3c34c7e84cc8406c758d162',
  'recovery-window.cjs':'b506ef4ab47f8fdcdcda6efb5830640bf0f3e0a7',
  'vendor/identity-service.cjs':'eb390252464f392eee04142d87fd0dbbc954f1ec',
  'vendor/enchantment-score-core.js':'238e7d22c496f4fc2d797d487078a1016414345b',
  'vendor/domain-utils.js':'7d0b51308b1d147aebe750ca856494c199854d09',
  'vendor/hunter-utils.js':'5791afaf15b54681592aa4f59b5d4fbc3029ac62',
  'vendor/hunter-license-v21.js':'c805acf0a973fb11325d02c9dacda45f94d8f360',
  'vendor/canonical.js':'aa7ea43adc5567d332917ae205491d7b93da7d1c'
 })
});
function gitBlobHash(bytes){
 const buf=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 const head=Buffer.from('blob '+buf.length+'\0');
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
 // These 12 files cover known direct reader/evaluator dependencies at this
 // candidate Git revision. Git blob matches and equal generation strings do
 // NOT verify bytes from the LIVE deployed artifact, Rules or service IAM.
 // Deliberately fail closed rather than expressing release approval.
 return {ok:false,reason:'live-artifact-identity-unverified',
  candidateFingerprintsMatch:true,checkedFiles:Object.keys(SOURCE.candidateGitBlobs).length,
  generationClaim:liveGeneration,releaseApproved:false};
}
module.exports={SOURCE,gitBlobHash,verifyCandidate};
