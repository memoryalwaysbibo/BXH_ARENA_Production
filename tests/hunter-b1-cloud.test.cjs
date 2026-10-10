'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const cloud=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
function setup({failure=false,cancelled=false,signedIn=true,players=[{id:'self'}]}={}){
 const regsStart=cloud.indexOf('async queryMyRegistrations('),regsEnd=cloud.indexOf('// P3 Hunter Profile:',regsStart);
 const hunterStart=cloud.indexOf('async queryMyHunterMatches('),hunterEnd=cloud.indexOf('// 輕量讀取',hunterStart);
 let publicReads=0;
 const fx={collection:()=>null,where:()=>null,query:()=>null,doc:(_, ...parts)=>parts,
 getDocs:async()=>({forEach:fn=>fn({id:'BXH-TEST'})}),getDoc:async parts=>{
 if(parts[0]==='tournaments'){
  if(failure)throw Error('unavailable');
  return {exists:()=>true,data:()=>({status:cancelled?'cancelled':'confirmed',localPlayerId:'self',displayName:'Tester'})};
 }
 publicReads++;return {exists:()=>true,data:()=>({name:'Test Event',eventDate:'2026-10-09'})};
 }};
 const context=vm.createContext({authReady:true,authHandle:{currentUser:signedIn?{uid:'u1'}:null},fx,dbHandle:{},console:{warn:()=>{}},reconstructPublicStateFromDoc:()=>({players}),buildHunterTournamentMatchRecords:()=>[{matchId:'m1',playerA:{localPlayerId:'self'},playerB:{localPlayerId:'op'},winnerLocalPlayerId:'self',scoreA:4,scoreB:0,analyzable:true,rounds:[]}]});
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
  assert.equal(result.skipped[0].identityIssue,issue);assert.equal(publicReads(),1);
 }
});
