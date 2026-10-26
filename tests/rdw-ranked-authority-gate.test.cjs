const test=require('node:test'),assert=require('node:assert/strict');
const {verifyRankedAuthority}=require('../scripts/lib/rdw-ranked-authority-gate.cjs');
const {inspectProductionStartReadiness}=require('../scripts/lib/rdw-production-start-readiness.cjs');
const eventCode='BXH-ABC123',actorUid='host';
const state={cloudCode:eventCode,createdBy:'creator',registrationRosterRevision:4,startedAt:null,rosterLocked:false,players:[{uid:'u1'},{uid:'u2'}],meta:{battleMode:'individual',ladderMode:'ranked',eventAuthority:'official'}};
const room=s=>({code:eventCode,data:JSON.stringify(s)});
const evidence={source:'trusted-server',verified:true,kind:'official-or-partner-ranked',eventCode,creatorUid:'creator',actorUid,authorized:true,rosterRevision:4};
test('ranked mode alone does not grant RDW privileges',()=>{
 const req={room:room(state),eventCode,actorUid,expectedRosterRevision:4,serverAuthorizationVerified:true,bracketVerified:true,canonicalWriterReady:true};
 assert.equal(inspectProductionStartReadiness(req).code,'ranked-grant-not-verified');
 assert.equal(inspectProductionStartReadiness({...req,rankedAuthorityEvidence:evidence}).ready,true);
});
test('creator, actor, event or revision mismatch and client flags fail closed',()=>{
 for(const changed of [{creatorUid:'wrong'},{actorUid:'wrong'},{eventCode:'BXH-OTHER1'},{rosterRevision:3},{source:'client'},{authorized:false},{verified:false},{kind:'community-ranked'}])
  assert.equal(verifyRankedAuthority({room:room(state),eventCode,actorUid,evidence:{...evidence,...changed}}).ok,false);
});
test('general, community, test and missing canonical owner are RDW-ineligible',()=>{
 for(const changed of [
  {meta:{...state.meta,ladderMode:'general'}},
  {meta:{...state.meta,eventAuthority:'community'}},
  {meta:{...state.meta,eventAuthority:'test'}},
  {testMode:true},
  {createdBy:undefined}
 ]){
  assert.equal(verifyRankedAuthority({room:room({...state,...changed}),eventCode,actorUid,evidence}).ok,false);
 }
});
