'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTeamMaintenance}=require('./maintenance.cjs');
test('disabled maintenance does not access workers',async()=>{
 let called=0;const f=createTeamMaintenance({enabled:()=>false,reconciler:{enqueue:()=>called++,runBatch:()=>called++},dissolution:{run:()=>called++}});
 assert.deepEqual(await f(),{status:'disabled'});assert.equal(called,0);
});
test('maintenance runs both workers and reports failures without skipping the other',async()=>{
 let steps=[];const f=createTeamMaintenance({enabled:()=>true,reconciler:{enqueue:async()=>{steps.push('enqueue');throw Error('private');},runBatch:async()=>steps.push('projection')},dissolution:{run:async()=>steps.push('dissolution')}});
 await assert.rejects(f(),/team-maintenance-failed/);assert.deepEqual(steps.sort(),['dissolution','enqueue']);
});
test('successful maintenance reports both worker results',async()=>{
 const f=createTeamMaintenance({enabled:()=>true,reconciler:{enqueue:async()=>{},runBatch:async()=>({status:'done'})},dissolution:{run:async()=>({status:'completed'})}});
 assert.deepEqual(await f(),{status:'completed',projection:{status:'done'},dissolution:{status:'completed'}});
});

test('maintenance reports failed dissolution candidates and expired leases',async()=>{
 for(const result of [{status:'completed',failed:1},{status:'lease-expired',failed:0}]){
  const f=createTeamMaintenance({enabled:()=>true,reconciler:{enqueue:async()=>{},runBatch:async()=>({status:'done'})},dissolution:{run:async()=>result}});
  await assert.rejects(f(),/team-dissolution-needs-attention/);
 }
});
test('shared maintenance includes bounded image cleanup and surfaces failures',async()=>{
 for(const failed of [0,1]){
  const f=createTeamMaintenance({enabled:()=>true,reconciler:{enqueue:async()=>{},runBatch:async()=>({status:'done'})},dissolution:{run:async()=>({status:'completed'})},emblems:{run:async()=>({status:'completed',failed})}});
  if(failed)await assert.rejects(f(),/team-emblem-cleanup-needs-attention/);else assert.equal((await f()).emblems.failed,0);
 }
});
