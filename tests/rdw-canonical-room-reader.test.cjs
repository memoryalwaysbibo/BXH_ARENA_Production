const test=require('node:test'),assert=require('node:assert/strict');
const {createCanonicalRoomReader}=require('../scripts/lib/rdw-canonical-room-reader.cjs');
const eventCode='BXH-ABC123';
function makeFixture({statePatch={},documentPatch={}}={}){
 const state={cloudCode:eventCode,registrationRosterRevision:9,startedAt:null,rosterLocked:false,meta:{battleMode:'individual'},players:[{uid:'one'},{uid:'two'}],...statePatch};
 const room={code:eventCode,data:JSON.stringify(state),...documentPatch};
 const paths=[],calls=[];
 const snap={exists:true,data:()=>room};
 const ref={get:async()=>{calls.push('direct');return snap;}};
 const db={doc:key=>{paths.push(key);return ref;}};
 const tx={get:async r=>{assert.equal(r,ref);calls.push('tx');return snap;}};
 return {read:createCanonicalRoomReader({db}),tx,calls,paths,request:{eventCode,expectedRosterRevision:9,actorUid:'host'}};
}
test('reads actual private tournament document rather than caller room',async()=>{
 const f=makeFixture(),result=await f.read({...f.request,room:{players:[{uid:'fake'}]}});
 assert.equal(result.ok,true);assert.deepEqual(result.rosterUids,['one','two']);
 assert.deepEqual(f.paths,['tournaments/BXH-ABC123']);assert.deepEqual(f.calls,['direct']);
});
test('inside transaction reads through transaction and detects changed roster',async()=>{
 const f=makeFixture({statePatch:{registrationRosterRevision:10}});
 const result=await f.read({...f.request,tx:f.tx});
 assert.equal(result.ok,false);assert.equal(result.reason,'roster-revision-stale');
 assert.deepEqual(f.calls,['tx']);
});
test('started, guardian, duplicated or malformed rooms are not trusted',async()=>{
 for(const patch of [{startedAt:123},{players:[{uid:'one'},{uid:'one'}]},{players:[{guardianUid:'parent',uid:'child'},{uid:'two'}]}]){
  const f=makeFixture({statePatch:patch}),r=await f.read(f.request);assert.equal(r.ok,false);
 }
});
test('invalid calls never read Firestore',async()=>{
 const f=makeFixture();
 for(const req of [{...f.request,actorUid:''},{...f.request,expectedRosterRevision:null},{...f.request,eventCode:'../../x'}])assert.equal((await f.read(req)).ok,false);
 assert.deepEqual(f.paths,[]);
});
