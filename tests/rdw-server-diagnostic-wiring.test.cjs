const test=require('node:test'),assert=require('node:assert/strict');
const {createServerDiagnostic}=require('../scripts/lib/rdw-server-diagnostic-wiring.cjs');
const code='BXH-ABC123';
function setup(role='admin'){
 const reads=[];
 const state={cloudCode:code,registrationRosterRevision:4,startedAt:null,rosterLocked:false,players:[{uid:'a'},{id:'virtual'}]};
 const db={doc:path=>({get:async()=>{reads.push(path);if(path==='users/actor')return {exists:true,data:()=>({role,active:true})};if(path==='tournaments/'+code)return {exists:true,data:()=>({code,data:JSON.stringify(state)})};return {exists:false};}})};
 const resolver=async({uid})=>({uid,source:'server',verified:true,version:'hunter-license-v2.1',status:'unchanged',computedAt:100,current:{tier:'d'},complete:true,unresolvedIdentities:0,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)});
 const service=createServerDiagnostic({db,readCurrentTierEvidence:resolver,clock:()=>200,enabled:true});
 return {service,reads};
}
test('server wiring resolves private room and canonical user privilege only',async()=>{
 const f=setup(),r=await f.service({actorUid:'actor',eventCode:code});
 assert.equal(r.ok,true);assert.equal(r.verifiedAccounts,1);assert.equal(r.virtualPlayers,1);assert.equal(r.fullSnapshotEligible,false);
 assert.deepEqual(f.reads,['users/actor','tournaments/'+code,'tournaments/'+code,'users/actor']);
});
test('staff cannot read private room',async()=>{
 const f=setup('staff'),r=await f.service({actorUid:'actor',eventCode:code});
 assert.equal(r.reason,'not-authorized');assert.deepEqual(f.reads,['users/actor']);
});
test('disabled service does not read Firestore',async()=>{
 const f=createServerDiagnostic();
 assert.equal((await f({actorUid:'actor',eventCode:code})).reason,'diagnostic-disabled');
});
