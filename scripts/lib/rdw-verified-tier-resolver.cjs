'use strict';
// P3-18: wired, verified Hunter 2.1 reader in a server-only environment.
// Provision audited bundle locally in the backend build; never ship it to the public site.
// Does not register a function or write Firestore.
const fs=require('node:fs'),path=require('node:path');
const {loadVerifiedReader}=require('./rdw-hunter-bundle-loader.cjs');
const {createReadOnlyTierResolver}=require('./rdw-hunter-readonly-bridge.cjs');
function createVerifiedTierResolver({db,clock,bundleRoot}){
 if(typeof bundleRoot!=='string'||!path.isAbsolute(bundleRoot))throw Error('absolute-hunter-bundle-path-required');
 const manifestPath=path.join(bundleRoot,'bundle-manifest.json');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 const createReader=loadVerifiedReader({root:bundleRoot,manifest});
 return createReadOnlyTierResolver({db,createReader,clock});
}
module.exports={createVerifiedTierResolver};
