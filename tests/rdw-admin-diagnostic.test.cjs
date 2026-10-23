const test=require('node:test'),assert=require('node:assert/strict');
const {inspectRdwDiagnostic}=require('../scripts/lib/rdw-admin-diagnostic.cjs');
const code='BXH-FIXTUR',time=2000;
const verified=(uid,tier)=>({source:'server',verified:true,version:'hunter-license-v2.1',uid,status:'unchanged',computedAt:1800,current:{tier}});
const room=players=>({code,data:JSON.stringify({cloudCode:code,registrationRosterRevision:4,startedAt:null,rosterLocked:false,players})});
test('denies all data to caller without verified admin privilege',()=>{
 assert.deepEqual(inspectRdwDiagnostic({room:room([{uid:'a'}]),eventCode:code,serverTime:time}),{ok:false,reason:'admin-authorization-required'});
});
test('two real players and six virtual identities stay diagnostic-only',()=>{
 const players=[{uid:'realA'},{uid:'realB'},...Array.from({length:6},(_,i)=>({id:'virtual'+i}))];
 const result=inspectRdwDiagnostic({room:room(players),eventCode:code,serverTime:time,adminVerified:true,tierEvidenceByUid:{realA:verified('realA','ungraded'),realB:verified('realB','d')}});
 assert.equal(result.ok,true);assert.equal(result.verifiedAccounts,2);assert.equal(result.virtualPlayers,6);assert.equal(result.fullSnapshotEligible,false);
 assert.deepEqual(result.formulaBands,[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}]);
 assert.equal(JSON.stringify(result).includes('realA'),false);
});
test('untrusted evidence is not treated as verified even if tier provided',()=>{
 const result=inspectRdwDiagnostic({room:room([{uid:'one'},{uid:'two'}]),eventCode:code,serverTime:time,adminVerified:true,tierEvidenceByUid:{one:verified('one','c'),two:{...verified('two','d'),source:'client'}}});
 assert.equal(result.unverifiedAccounts,1);assert.equal(result.fullSnapshotEligible,false);
});
test('duplicate and guardian alias ambiguity abort whole diagnostic',()=>{
 for(const players of [[{uid:'a'},{uid:'a'}],[{uid:'a',guardianUid:'guardian'},{uid:'b'}]]){
  assert.equal(inspectRdwDiagnostic({room:room(players),eventCode:code,serverTime:time,adminVerified:true}).ok,false);
 }
});
test('complete verified roster can be eligible but diagnostic performs no writes',()=>{
 const original=room([{uid:'one'},{uid:'two'}]),before=JSON.stringify(original);
 const result=inspectRdwDiagnostic({room:original,eventCode:code,serverTime:time,adminVerified:true,tierEvidenceByUid:{one:verified('one','c'),two:verified('two','d')}});
 assert.equal(result.fullSnapshotEligible,true);assert.equal(JSON.stringify(original),before);
});
