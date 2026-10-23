'use strict';
// P3-17: only load Hunter 2.1 reader from a locally provisioned, integrity-checked bundle.
// No network, no production source downloads, and no grant-service invocation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EXPECTED_ZIP_SHA256='90c00efb537b216771f157b9ceff4cfaa11d6abb0d3a4aba6978b0600d779963';
const EXPECTED_FILES=Object.freeze(['index.js','package.json','package-lock.json','callable.cjs','service.cjs','reader.cjs','evaluator.cjs','recovery-window.cjs','vendor/domain-utils.js','vendor/hunter-utils.js','vendor/hunter-license-v21.js','vendor/enchantment-score-core.js','vendor/canonical.js','vendor/provenance.json','vendor/identity-service.cjs']);
function verifyBundle({root,manifest}){
 if(!root||!manifest||typeof manifest!=='object'||!Object.keys(manifest).length)throw Error('hunter-bundle-manifest-required');
 const names=Object.keys(manifest).sort();
 if(names.length!==EXPECTED_FILES.length||EXPECTED_FILES.some(n=>!names.includes(n)))throw Error('hunter-bundle-incomplete-or-unexpected-manifest');
 const checked=[];
 for(const [name,info] of Object.entries(manifest)){
  if(!/^(?:vendor\/)?[a-zA-Z0-9_.-]+$/.test(name)||typeof info!=='string'||!/^[a-f0-9]{64}$/.test(info))throw Error('hunter-bundle-invalid-manifest-entry');
  const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
  if(actual!==info)throw Error('hunter-bundle-hash-mismatch:'+name);
  checked.push(name);
 }
 if(!checked.includes('reader.cjs')||!checked.includes('evaluator.cjs')||!checked.includes('vendor/provenance.json'))throw Error('hunter-bundle-required-files-missing');
 return Object.freeze({checked:checked.length,zipSha256:EXPECTED_ZIP_SHA256});
}
function loadVerifiedReader({root,manifest}){
 verifyBundle({root,manifest});
 const {createReader}=require(path.resolve(root,'reader.cjs'));
 if(typeof createReader!=='function')throw Error('hunter-reader-export-missing');
 return createReader;
}
module.exports={verifyBundle,loadVerifiedReader};
