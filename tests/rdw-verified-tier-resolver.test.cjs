'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-verified-reader-'));
 fs.mkdirSync(path.join(root,'vendor'));
 const files={
  'reader.cjs':"module.exports={createReader:()=>async({uid})=>({uid,version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,sourceDigest:'a'.repeat(64),sourceScope:'public-official-canonical-self-history-v1',overview:{grade:{tier:'c'}}})};",
  'evaluator.cjs':'module.exports={};',
  'vendor/provenance.json':'{}'
 };
 const manifest={};for(const [name,contents] of Object.entries(files)){fs.writeFileSync(path.join(root,name),contents);manifest[name]=hash(contents);}
 fs.writeFileSync(path.join(root,'bundle-manifest.json'),JSON.stringify(manifest));
 const writes=[];
 const db={doc:p=>({path:p}),runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>({active:true})}),set:()=>writes.push('set'),create:()=>writes.push('create'),update:()=>writes.push('update')})};
 return {root,db,writes};
}
test('verified reader bundle resolves current tier without award writes',async()=>{
 const f=fixture(),resolver=createVerifiedTierResolver({db:f.db,clock:()=>100,bundleRoot:f.root});
 const result=await resolver('u1');assert.equal(result.ok,true);assert.equal(result.tier,'c');assert.deepEqual(f.writes,[]);
});
test('tampering with bundled Reader prevents execution',()=>{
 const f=fixture();fs.writeFileSync(path.join(f.root,'reader.cjs'),'module.exports={}');
 assert.throws(()=>createVerifiedTierResolver({db:f.db,clock:()=>100,bundleRoot:f.root}),/hash-mismatch/);
});
test('nonabsolute bundle path rejected',()=>assert.throws(()=>createVerifiedTierResolver({bundleRoot:'relative'}),/absolute-hunter/));
