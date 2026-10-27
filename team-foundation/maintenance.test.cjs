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
