const test=require('node:test'),assert=require('node:assert/strict');
const {inspectTournament}=require('../scripts/lib/rdw-roster-inspection.cjs');
const code='BXH-SDSAQZ';const state={cloudCode:code,registrationRosterRevision:3,startedAt:null,rosterLocked:false,meta:{battleMode:'individual'},players:[{uid:'u1'},{uid:'u2'}]};
const input=(s=state)=>({room:{code,data:JSON.stringify(s)},code,actorUid:'host',expectedRosterRevision:3});
test('accepts consistent server-owned roster without writes',()=>{const before=JSON.stringify(state);assert.deepEqual(inspectTournament(input()),{ok:true,code,rosterRevision:3,uids:['u1','u2']});assert.equal(JSON.stringify(state),before);});
test('rejects virtual players without canonical UID',()=>assert.equal(inspectTournament(input({...state,players:[{id:'virtual-1'},{uid:'u2'}]})).reason,'canonical-uid-unverified'));
test('rejects duplicate UID, stale roster, started or team rooms',()=>{
 for(const s of [{...state,players:[{uid:'u1'},{uid:'u1'}]},{...state,registrationRosterRevision:4},{...state,startedAt:123},{...state,meta:{battleMode:'team'}}])assert.equal(inspectTournament(input(s)).ok,false);
});
