const test=require('node:test'),assert=require('node:assert/strict');
const {readCanonicalEvent}=require('../scripts/lib/rdw-production-event-guard.cjs');
const eventCode='BXH-SDSAQZ';
const state={cloudCode:eventCode,registrationRosterRevision:4,startedAt:null,rosterLocked:false,meta:{battleMode:'individual'},players:[{uid:'alpha'},{registrationUid:'beta'}]};
const read=(s=state,options={})=>readCanonicalEvent({room:{code:eventCode,data:JSON.stringify(s)},eventCode,expectedRosterRevision:4,actorUid:'host',...options});
test('extracts canonical UID roster from real ARENA JSON state, never assumes flat fields',()=>{const r=read();assert.equal(r.ok,true);assert.deepEqual(r.rosterUids,['alpha','beta']);assert.equal(r.needsServerAuthorization,true);assert.equal(r.needsBracketValidation,true);});
test('rejects started, locked, stale, and missing revision',()=>{for(const s of [{...state,startedAt:20},{...state,rosterLocked:true},{...state,registrationRosterRevision:3},{...state,registrationRosterRevision:undefined}])assert.equal(read(s).ok,false);});
test('family identities, mismatched aliases and team modes fail closed',()=>{for(const s of [{...state,players:[{guardianUid:'parent',uid:'child'},{uid:'beta'}]},{...state,players:[{uid:'a',registrationUid:'b'},{uid:'beta'}]},{...state,meta:{battleMode:'team'}}])assert.equal(read(s).ok,false);});
test('malformed JSON and mismatched room code are rejected',()=>{assert.equal(readCanonicalEvent({room:{data:'not json'},eventCode,expectedRosterRevision:4,actorUid:'host'}).reason,'invalid-json-state');assert.equal(read(state,{eventCode:'BXH-OTHER1'}).ok,false);});
