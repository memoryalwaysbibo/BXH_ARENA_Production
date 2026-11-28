const test=require('node:test'),assert=require('node:assert/strict');
const {decide}=require('../scripts/lib/rdw-pass-gate.cjs');
const base={captureStatus:'failed',readbackStatus:'missing',authorized:true,rosterValid:true,drawRevisionValid:true,actorUid:'host',eventCode:'BXH-TEST',reason:'backend-unavailable'};
test('RDW-only PASS permits official start but marks RDW ineligible',()=>{assert.deepEqual(decide(base),{allowed:true,reason:'rdw-only-pass',rdwEligible:false});});
test('cannot PASS missing identity, roster, authorization or stale draw',()=>{
 for(const patch of [{authorized:false},{rosterValid:false},{drawRevisionValid:false},{actorUid:null},{eventCode:null}])assert.equal(decide({...base,...patch}).allowed,false);
});
test('timeout uncertainty and verified snapshot fail closed',()=>{
 for(const patch of [{readbackStatus:'unknown'},{readbackStatus:'verified'},{captureStatus:'success'},{reason:null}])assert.equal(decide({...base,...patch}).allowed,false);
 assert.equal(decide({...base,captureStatus:'timeout'}).allowed,true);
});
