'use strict';
// P3-17: only load Hunter 2.1 reader from a locally provisioned, integrity-checked bundle.
// No network, no production source downloads, and no grant-service invocation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EXPECTED_ZIP_SHA256='90c00efb537b216771f157b9ceff4cfaa11d6abb0d3a4aba6978b0600d779963';
function verifyBundle({root,manifest}){
 if(!root||!manifest||typeof manifest!=='object'||!manifest.files)throw Error('hunter-bundle-manifest-required');
 const checked=[];
 for(const [name,info] of Object.entries(manifest.files)){
  if(!/^(?:vendor\/)?[a-zA-Z0-9_.-]+$/.test(name)||typeof info?.sha256!=='string'||!/^[a-f0-9]{64}$/.test(info.sha256))throw Error('hunter-bundle-invalid-manifest-entry');
  const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
  if(actual!==info.sha256)throw Error('hunter-bundle-hash-mismatch:'+name);
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
