const test=require('node:test'),assert=require('node:assert/strict');
const {createAdminDiagnosticService}=require('../scripts/lib/rdw-admin-diagnostic-service.cjs');
const code='BXH-TEST01';
const doc={code,data:JSON.stringify({cloudCode:code,registrationRosterRevision:4,startedAt:null,rosterLocked:false,players:[{uid:'a'},{uid:'b'},...Array.from({length:6},(_,i)=>({id:'virtual-'+i}))]})};
const evidence=uid=>({source:'server',verified:true,version:'hunter-license-v2.1',status:'unchanged',uid,computedAt:100,current:{tier:uid==='a'?'ungraded':'d'},complete:true,unresolvedIdentities:0,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)});
function setup({allowed=true}={}){
 const calls=[];let auth=allowed;
 const service=createAdminDiagnosticService({enabled:true,authorizeAdmin:async()=>{calls.push('auth');return auth;},readRoom:async()=>{calls.push('room');return doc;},readCurrentTierEvidence:async({uid})=>{calls.push('tier');return evidence(uid);},clock:()=>200});
 return {service,calls,revoke:()=>{auth=false;}};
}
test('feature disabled: no backend dependencies required',async()=>assert.equal((await createAdminDiagnosticService()({actorUid:'admin',eventCode:code})).reason,'diagnostic-disabled'));
test('authorization gates tier reads, and result reveals no UID',async()=>{
 const f=setup();const r=await f.service({actorUid:'admin',eventCode:code,adminVerified:true,tierEvidenceByUid:{a:{current:{tier:'national'}}}});
 assert.equal(r.ok,true);assert.equal(r.verifiedAccounts,2);assert.equal(r.virtualPlayers,6);assert.equal(r.fullSnapshotEligible,false);
 assert.deepEqual(r.formulaBands,[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}]);
 assert.deepEqual(f.calls,['auth','room','tier','tier','room','auth']);
 assert.equal(JSON.stringify(r).includes('"a"'),false);
});
test('unauthorized caller does not fetch roster or tiers',async()=>{const f=setup({allowed:false});const r=await f.service({actorUid:'admin',eventCode:code});assert.equal(r.reason,'not-authorized');assert.deepEqual(f.calls,['auth']);});
test('malformed actor and event rejected before authentication',async()=>{const f=setup();assert.equal((await f.service({actorUid:'',eventCode:code})).reason,'invalid-request');assert.deepEqual(f.calls,[]);});
