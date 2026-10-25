const test=require('node:test'),assert=require('node:assert/strict');
const {inspectProductionStartReadiness}=require('../scripts/lib/rdw-production-start-readiness.cjs');
const eventCode='BXH-SAMPLE',actorUid='server-host',expectedRosterRevision=4;
const state={cloudCode:eventCode,startedAt:null,rosterLocked:false,registrationRosterRevision:4,meta:{battleMode:'individual',ladderMode:'ranked'},players:[{uid:'a'},{uid:'b'}]};
const room={code:eventCode,data:JSON.stringify(state)};
const base={room,eventCode,actorUid,expectedRosterRevision};
test('production writer must be independently audited before start can be authorized',()=>{
 assert.equal(inspectProductionStartReadiness(base).code,'server-authorization-not-proven');
 assert.equal(inspectProductionStartReadiness({...base,serverAuthorizationVerified:true}).code,'server-bracket-not-proven');
 assert.equal(inspectProductionStartReadiness({...base,serverAuthorizationVerified:true,bracketVerified:true}).code,'canonical-json-and-public-mirror-writer-not-ready');
});
test('all trusted server gates allow readiness only, never a database write',()=>{
 const result=inspectProductionStartReadiness({...base,serverAuthorizationVerified:true,bracketVerified:true,canonicalWriterReady:true});
 assert.deepEqual(result,{ready:true,eventCode,rosterUids:['a','b'],rosterRevision:4});
 assert.equal(JSON.parse(room.data).startedAt,null);
});
test('real ARENA state fails closed if mixed UID or started, even when all flags are true',()=>{
 const flags={serverAuthorizationVerified:true,bracketVerified:true,canonicalWriterReady:true};
 for(const delta of [{players:[{uid:'a'},{id:'virtual'}]},{startedAt:200},{registrationRosterRevision:5},{meta:{battleMode:'team'}}]){
  const r=inspectProductionStartReadiness({...base,...flags,room:{code:eventCode,data:JSON.stringify({...state,...delta})}});
  assert.equal(r.ready,false);
 }
});
