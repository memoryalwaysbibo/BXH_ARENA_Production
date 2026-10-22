const test=require('node:test'),assert=require('node:assert/strict');
const {createReadOnlyTierResolver}=require('../scripts/lib/rdw-hunter-readonly-bridge.cjs');
function fixture({user={active:true},evidence={uid:'u1',version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,overview:{grade:{tier:'c'}},sourceDigest:'digest'}}={}){
 const writes=[];let readOnly=false;
 const tx={get:async()=>({exists:!!user,data:()=>user}),set:()=>writes.push('set'),create:()=>writes.push('create'),update:()=>writes.push('update')};
 const db={doc:p=>({path:p}),runTransaction:async(fn,options)=>{readOnly=options?.readOnly===true;return fn(tx);}};
 const resolve=createReadOnlyTierResolver({db,createReader:()=>async()=>evidence,clock:()=>1234});
 return {resolve,writes,get readOnly(){return readOnly;}};
}
test('server history yields current tier without modifying lifetime ledger',async()=>{const f=fixture();const r=await f.resolve('u1');assert.equal(r.ok,true);assert.equal(r.tier,'c');assert.equal(f.readOnly,true);assert.deepEqual(f.writes,[]);});
test('incomplete history, wrong uid, and test accounts fail closed',async()=>{for(const config of [{evidence:{uid:'u1',complete:false}},{evidence:{uid:'other',version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,overview:{grade:{tier:'a'}}}},{user:{active:true,isTestAccount:true}}]){const f=fixture(config);assert.equal((await f.resolve('u1')).ok,false);assert.deepEqual(f.writes,[]);}});
