'use strict';
// Optional integration test using the EXACT audited production Hunter reader bundle.
// Supply RDW_HUNTER_BUNDLE_ROOT=/absolute/path/to/extracted/source.zip.
// No Firebase credentials, network, writes, or production reads.
const test=require('node:test'),assert=require('node:assert/strict');
const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');
const path=require('node:path');
const root=process.env.RDW_HUNTER_BUNDLE_ROOT;
test('audited Hunter reader resolves empty-history player without writes', {skip:!root?'RDW_HUNTER_BUNDLE_ROOT not set':false},async()=>{
 const writes=[];
 const query={where(){return this;},select(){return this;},limit(){return this;}};
 const db={
  doc:key=>({key}),
  collection:collectionName=>({key:collectionName,...query}),
  async runTransaction(callback){
   return callback({
    async get(ref){
     if(ref.key==='publicTournaments')return {size:0,docs:[]};
     if(ref.key==='users/fixtureUid')return {exists:true,data:()=>({active:true})};
     return {exists:false,data:()=>null};
    },
    set(){writes.push('set');},create(){writes.push('create');},update(){writes.push('update');},delete(){writes.push('delete');}
   });
  }
 };
 const resolve=createVerifiedTierResolver({db,clock:()=>Date.now(),bundleRoot:path.resolve(root)});
 const result=await resolve('fixtureUid');
 assert.equal(result.ok,true);
 assert.equal(result.tier,'ungraded');
 assert.equal(result.sourceScope,'public-official-canonical-self-history-v1');
 assert.match(result.sourceDigest,/^[a-f0-9]{64}$/);
 assert.deepEqual(writes,[]);
});
