const test=require('node:test'),assert=require('node:assert/strict');
const {classifyRdwEvent}=require('../scripts/lib/rdw-event-type-policy.cjs');
const {inspectProductionStartReadiness}=require('../scripts/lib/rdw-production-start-readiness.cjs');
const code='BXH-ABC123';
const base={cloudCode:code,registrationRosterRevision:2,startedAt:null,rosterLocked:false,players:[{uid:'u1'},{uid:'u2'}],createdBy:'creator',meta:{eventAuthority:'official',battleMode:'individual',ladderMode:'ranked'}};
const room=s=>({code,data:JSON.stringify(s)});
const rankedAuthorityEvidence={source:'trusted-server',verified:true,kind:'official-or-partner-ranked',eventCode:code,actorUid:'host',creatorUid:'creator',rosterRevision:2,authorized:true};
test('ranked tournaments can enter RDW readiness checks',()=>{
 assert.deepEqual(classifyRdwEvent({room:room(base)}),{ok:true,rdwApplicable:true,mode:'ranked'});
 const result=inspectProductionStartReadiness({room:room(base),eventCode:code,actorUid:'host',expectedRosterRevision:2,rankedAuthorityEvidence,serverAuthorizationVerified:true,bracketVerified:true,canonicalWriterReady:true});
 assert.equal(result.ready,true);
});
test('general tournaments never enter RDW snapshot, PASS or score flow',()=>{
 const general={...base,meta:{...base.meta,ladderMode:'general'}};
 assert.deepEqual(classifyRdwEvent({room:room(general)}),{ok:true,rdwApplicable:false,mode:'general'});
 const result=inspectProductionStartReadiness({room:room(general),eventCode:code,actorUid:'host',expectedRosterRevision:2,serverAuthorizationVerified:true,bracketVerified:true,canonicalWriterReady:true});
 assert.deepEqual(result,{ready:false,code:'rdw-not-applicable-general-event',rdwApplicable:false});
});
test('missing or unknown server tournament mode fails closed',()=>{
 for(const mode of [undefined,null,'official','test','Ranked','']){
  const state={...base,meta:{battleMode:'individual',ladderMode:mode}};
  assert.equal(classifyRdwEvent({room:room(state)}).ok,false);
  assert.equal(inspectProductionStartReadiness({room:room(state),eventCode:code,actorUid:'host',expectedRosterRevision:2}).ready,false);
 }
});
