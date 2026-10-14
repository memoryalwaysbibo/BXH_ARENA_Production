'use strict';
// Local-only packaging input: reviewed manifest + exact source allowlist + source asset root.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const model=require('../modules/bey-catalog/catalog-candidate-model.js');
const inventory=require('../modules/bey-catalog/catalog-pending-model.js');
const root=path.resolve(__dirname,'..');
function prepare(manifestPath,allowlistPath,assetRoot){
 const input=JSON.parse(fs.readFileSync(manifestPath,'utf8')),sourceURLs=JSON.parse(fs.readFileSync(allowlistPath,'utf8'));
 const policy={inventorySha256:inventory.EXPECTED_SHA256,recordIds:Array.from({length:285},(_,i)=>'supplied_20261014_'+String(i+1).padStart(4,'0')),sourceURLs};
 const data=model.validate(input,policy),bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');
 const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const imageURLs=[...new Set(data.entries.map(r=>r.imageURL))];
 for(const imageURL of imageURLs){
  const b=fs.readFileSync(path.join(assetRoot,imageURL)),hash=crypto.createHash('sha256').update(b).digest('hex');
  if(imageURL!=='assets/bey-catalog/candidates/'+hash+'.webp'||b.length>2097152||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WEBP')throw Error('CANDIDATE_ASSET_MISMATCH');
  const dest=path.join(root,imageURL);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);
 }
 const dataURL='./data/bey-catalog-pending/candidate-images.'+sha256+'.json';
 fs.writeFileSync(path.join(root,dataURL),bytes);
 const config={...policy,sha256,bytes:bytes.length,dataURL,imageURLs};
 fs.writeFileSync(path.join(root,'modules/bey-catalog/catalog-candidate-policy.js'),"'use strict';\n(function(root){\n const policy="+JSON.stringify(config,null,2)+";\n for(const key of ['recordIds','sourceURLs','imageURLs'])Object.freeze(policy[key]);\n Object.freeze(policy);\n if(typeof module==='object'&&module.exports)module.exports=policy;else root.BXHCandidatePolicy=policy;\n})(typeof window==='object'?window:globalThis);\n");
 return {entries:data.entries.length,images:imageURLs.length,sha256,bytes:bytes.length};
}
if(require.main===module){if(process.argv.length!==5)throw Error('EXPECTED_MANIFEST_ALLOWLIST_ASSET_ROOT');console.log(JSON.stringify(prepare(...process.argv.slice(2))));}
module.exports={prepare};
