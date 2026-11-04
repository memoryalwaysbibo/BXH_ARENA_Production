'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {patchRebuild}=require('../../../release/buckets/my-events/patch-rebuild.cjs');
const source=readFileSync(path.join(__dirname,'deployed-rebuild.cjs'),'utf8');
function candidate(){
 const exports={};
 const engine={SCHEMA:26,RELEASE:'test',COUNTERS:['self'],PATHS:{refs:'refs',failures:'failures'},bucket:()=> 'self',validCounts:()=>true,stamp:x=>x,same:(a,b)=>JSON.stringify(a)===JSON.stringify(b),target:()=>{throw Error('legacy-target-used')},summary:()=>({})};
 const context={module:{exports},exports,require:id=>id==='node:crypto'?require(id):id==='./engine.cjs'?engine:id==='./owners'?{collectOwners:()=>({status:'supported',hasUnknownOwners:false,ownerUids:[]})}:id==='./lifecycle.js'?{normalizeLifecycle:()=>({status:'supported',active:false})}:require(id)};
 vm.runInNewContext(patchRebuild(source),context,{filename:'candidate-rebuild.cjs'});
 return context.module.exports;
}
test('exact deployed rebuild patch rejects drift and removes root-only target',()=>{
 assert.throws(()=>patchRebuild(source+'\n'),/source-drift/);
 const patched=patchRebuild(source);
 assert.doesNotMatch(patched,/target\(room\)/);
 assert.match(patched,/await verifiedTarget\(resolveRoomLifecycle,b,tx,code,room\)/);
});
test('dual-write target reads verified bucket scope before rejecting stale generation',async()=>{
 const {reconcileInTransaction}=candidate();
 const reads=[];
 const room={exists:true,ref:{path:'tournaments/SIX'},data:()=>({}),createTime:{seconds:1,nanoseconds:0}};
 const tx={get:async ref=>{reads.push(ref.path);return {exists:true,ref,data:()=>({})}}};
 const b={doc:p=>({path:p})};
 let resolved=0;
 const out=await reconcileInTransaction({bridge:b,tx,code:'SIX',id:'reg',row:{createTime:room.createTime,updateTime:room.createTime},room,jobSnapshot:{data:()=>({generation:'old',roomIncarnation:room.createTime})},at:100,expectedRebuildGeneration:'new',rebuildLease:'token',resolveRoomLifecycle:async ({tx:actual,code})=>{assert.equal(actual,tx);assert.equal(code,'SIX');resolved++;return {status:'supported',active:true}}});
 assert.equal(out.status,'stale-rebuild');
 assert.equal(out.roomTarget,'active');
 assert.equal(resolved,1);
 assert.deepEqual(reads,[]);
});
test('enabled rebuilder requires a bucket lifecycle resolver',()=>{
 const {createRebuilder}=candidate();
 assert.throws(()=>createRebuilder({enabled:true,bridge:{run(){},collectionGroup(){}},engine:{ingestRegistration(){}}}),/rebuild-dependencies/);
});
test('beginRoom rejects a stale root or changed bucket target before writes',async()=>{
 const {createRebuilder}=candidate();
 const tx={get:async ref=>ref.path==='tournaments/SIX'?{exists:true,ref,createTime:{seconds:1,nanoseconds:0},updateTime:{seconds:2,nanoseconds:0},data:()=>({})}:{exists:false,ref,data:()=>null},set(){throw Error('unexpected-write')}};
 const b={doc:path=>({path}),collectionGroup(){return {}},run:async (_name,fn)=>({value:await fn(tx)})};
 const engine={ingestRegistration(){}};
 let resolved=0;
 const rebuilder=createRebuilder({enabled:true,bridge:b,engine,clock:()=>100,resolveRoomLifecycle:async()=>{resolved++;return {status:'supported',active:false}}});
 assert.equal((await rebuilder.beginRoom({code:'SIX',expectedSourceUpdateTime:{seconds:1,nanoseconds:0},expectedTarget:'active'})).status,'stale-source');
 assert.equal(resolved,0);
 assert.equal((await rebuilder.beginRoom({code:'SIX',expectedSourceUpdateTime:{seconds:2,nanoseconds:0},expectedTarget:'active'})).status,'stale-source');
 assert.equal(resolved,1);
});
