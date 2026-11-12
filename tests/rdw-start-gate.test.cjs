const test=require('node:test'),assert=require('node:assert/strict');
const {chooseStart}=require('../scripts/lib/rdw-start-gate.cjs');
const base={authorized:true,rosterValid:true,drawRevisionValid:true,actorUid:'host',eventCode:'BXH-TEST',failureReason:'timeout'};
test('verified snapshot permits start without PASS',()=>assert.equal(chooseStart({...base,snapshotState:'verified',readbackStatus:'verified'}).mode,'rdw-verified'));
test('failed capture needs explicit PASS and readback confirmation',()=>{
 assert.equal(chooseStart({...base,snapshotState:'failed',readbackStatus:'missing'}).start,false);
 const result=chooseStart({...base,snapshotState:'failed',readbackStatus:'missing',passRequested:true});assert.equal(result.mode,'rdw-pass');assert.equal(result.auditRequired,true);assert.equal(result.rdwEligible,false);
 assert.equal(chooseStart({...base,snapshotState:'timeout',readbackStatus:'unknown',passRequested:true}).start,false);
});
test('authorization, stale draw and roster failure cannot be bypassed',()=>{
 for(const patch of [{authorized:false},{rosterValid:false},{drawRevisionValid:false}])assert.equal(chooseStart({...base,...patch,snapshotState:'failed',readbackStatus:'missing',passRequested:true}).start,false);
});
