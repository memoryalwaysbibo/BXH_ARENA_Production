'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const cloud=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
function setup({failure=false,cancelled=false,status,phase,runtimeFields={},publicFields={},signedIn=true,players=[{id:'self'}],matches=[]}={}){
 const regsStart=cloud.indexOf('async queryMyRegistrations('),regsEnd=cloud.indexOf('// P3 Hunter Profile:',regsStart);
 const hunterStart=cloud.indexOf('async queryMyHunterMatches('),hunterEnd=cloud.indexOf('// 輕量讀取',hunterStart);
 let publicReads=0;
 const fx={collection:()=>null,where:()=>null,query:()=>null,doc:(_, ...parts)=>parts,
 getDocs:async()=>({forEach:fn=>fn({id:'BXH-TEST',exists:()=>true,data:()=>({name:'Test Event',eventDate:'2026-10-09',bracketView:'{}',tournamentPhase:phase,...publicFields})})}),getDoc:async parts=>{
 if(parts[0]==='tournaments'){
  if(failure)throw Error('unavailable');
  return {exists:()=>true,data:()=>({status:status||(cancelled?'cancelled':'confirmed'),localPlayerId:'self',displayName:'Tester'})};
 }
 publicReads++;return {exists:()=>true,data:()=>({name:'Test Event',eventDate:'2026-10-09',bracketView:'{}',tournamentPhase:phase,...publicFields})};
 }};
 const context=vm.createContext({authReady:true,authHandle:{currentUser:signedIn?{uid:'u1'}:null},personalScan:null,personalPublicDocs:new Map(),queueMicrotask,fx,dbHandle:{},console:{warn:()=>{}},reconstructPublicStateFromDoc:()=>({players,matches,...runtimeFields}),buildHunterTournamentMatchRecords:()=>[{matchId:'m1',playerA:{localPlayerId:'self'},playerB:{localPlayerId:'op'},winnerLocalPlayerId:'self',scoreA:4,scoreB:0,analyzable:true,rounds:[]}]});
 vm.runInContext('api=({'+cloud.slice(regsStart,regsEnd)+cloud.slice(hunterStart,hunterEnd)+'});',context);
 return {api:context.api,publicReads:()=>publicReads};
}
test('registration failure reaches Hunter coverage instead of becoming zero history',async()=>{
 const {api}=setup({failure:true});const result=await api.queryMyHunterMatches();
 assert.equal(result.records.length,0);assert.equal(result.skipped[0].reason,'registration-read-failed');
});
test('cancelled registration retains a previously completed historical match',async()=>{
 const {api}=setup({cancelled:true});assert.equal((await api.queryMyHunterMatches()).records.length,1);
});
test('missing authentication is an error, not a successful empty history',async()=>{
 const {api}=setup({signedIn:false});await assert.rejects(()=>api.queryMyHunterMatches(),/hunter-auth-required/);
});
test('multiple registrations for the same event cannot duplicate reads or matches',async()=>{
 const {api,publicReads}=setup();api.queryMyRegistrations=async()=>[{tournamentCode:'BXH-TEST',localPlayerId:'self'},{tournamentCode:'bxh-test',localPlayerId:'self'}];
 const result=await api.queryMyHunterMatches();assert.equal(result.records.length,1);assert.equal(publicReads(),1);
});
test('unresolved identity identifies the event and distinguishes missing from ambiguous players',async()=>{
 for(const [players,issue] of [[[], 'participant-not-found'],[[{id:'p1',name:'Tester'},{id:'p2',name:'Tester'}],'ambiguous-name']]){
  const {api,publicReads}=setup({players});const result=await api.queryMyHunterMatches();
  assert.equal(result.records.length,0);assert.equal(result.skipped[0].code,'BXH-TEST');
  assert.equal(result.skipped[0].eventName,'Test Event');assert.equal(result.skipped[0].eventDate,'2026-10-09');
  assert.equal(result.skipped[0].identityIssue,issue);assert.equal(publicReads(),0);
 }
});
test('cancelled, waitlist and raffle-not-selected registrations without participation do not block real history',async()=>{
 for(const status of ['cancelled','waitlist','not_selected']){
  const {api}=setup({status,players:[{id:'op',name:'Other'}]});
  const result=await api.queryMyHunterMatches();assert.equal(result.records.length,0);assert.equal(result.skipped.length,0);
 }
});
test('missing roster with match evidence and ambiguous cancelled names still require identity review',async()=>{
 for(const options of [
  {matches:[{a:{playerId:'self'}}]},
  {matches:{m1:{b:{playerId:'reg_u1'}}}},
  {players:[{id:'p1',name:'Tester'},{id:'p2',name:'Tester'}]}
 ]){
  const {api}=setup({status:'cancelled',players:[],...options});
  const result=await api.queryMyHunterMatches();assert.equal(result.skipped[0].reason,'identity-unresolved');
 }
});
test('confirmed or unknown registrations missing identity remain incomplete',async()=>{
 for(const status of ['confirmed','unknown']){
  const {api}=setup({status,players:[]});assert.equal((await api.queryMyHunterMatches()).skipped[0].reason,'identity-unresolved');
 }
});

test('waiting registration without a player or played match does not block Hunter history',async()=>{
 for(const options of [
  {players:[]},
  {players:[],publicFields:{bracketView:null}},
  {players:[],matches:[{a:{playerId:'self'},completed:false,scoreA:0,scoreB:0}]},
  {players:[],matches:[{isBye:true,completed:true,winnerId:'self'}]},
  {players:[{id:'self'}]}
 ]){
  const {api}=setup({phase:'waiting',...options});const result=await api.queryMyHunterMatches();
  assert.equal(result.records.length,0);assert.equal(result.skipped.length,0);
 }
});
test('stale waiting phase cannot conceal started or completed history',async()=>{
 for(const options of [
  {runtimeFields:{startedAt:1}},
  {runtimeFields:{archiveStatus:'completed'}},
  {publicFields:{completedAt:1}},
  {matches:[{completed:true,winnerId:'op'}]},
  {matches:{m1:{startedAt:1}}},
  {matches:[{log:[{type:'spin'}]}]}
 ]){
  const {api}=setup({phase:'waiting',players:[],...options});const result=await api.queryMyHunterMatches();
  assert.equal(result.skipped[0].reason,'identity-unresolved');
 }
});
test('live and finished events still require unresolved identities to be reviewed',async()=>{
 for(const phase of ['live','settling','done']){
  const {api}=setup({phase,players:[]});assert.equal((await api.queryMyHunterMatches()).skipped[0].reason,'identity-unresolved');
 }
});
test('waiting mirror with completed matches retains actual linked history',async()=>{
 const {api}=setup({phase:'waiting',matches:[{completed:true,winnerId:'self'}]});
 assert.equal((await api.queryMyHunterMatches()).records.length,1);
});

test('not-selected registration cannot erase actual match evidence',async()=>{
 const {api}=setup({status:'not_selected',players:[],matches:[{a:{playerId:'self'},completed:true}]});
 assert.equal((await api.queryMyHunterMatches()).skipped[0].reason,'identity-unresolved');
});
