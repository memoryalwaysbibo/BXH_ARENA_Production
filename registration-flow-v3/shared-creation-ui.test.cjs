'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
const cloud=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8');
function fragment(a,b){const i=core.indexOf(a),j=core.indexOf(b,i+a.length);assert(i>=0&&j>i);return core.slice(i,j);}
const valid={ladderMode:'general',battleMode:'individual',formatType:'single',playMode:'standard',registrationEnabled:true,registrationVisibility:'public',targetGroup:'open',waitlistCapacity:0,participantNameMode:'realName',checkinRequired:true,registrationCapacity:128,stations:4,date:'2027-01-01',startTime:'13:00',name:'Test',location:'Arena',registrationOpenAt:1,registrationCloseAt:2,cancellationDeadline:3};
test('V3 entry opens shared new-tournament draft rather than independent form',()=>{
 const code=fragment('  if(action==="v3-create-open"){','  if(action==="cloud-admin-new-tournament"){');
 let args;const context={action:'v3-create-open',isSuperAdmin:()=>true,canCreateOfficialTournament:()=>true,closeModal(){},doNewTournament:(...a)=>{args=a;}};
 vm.runInNewContext('(function(){'+code+'})()',context);assert.deepEqual(args,[false,3]);
 assert(!code.includes('v3-create-name'));assert.match(cloud,/registrationFlowVersion===3.*registration-v3-required/);
});
test('existing V3 backend contract is not silently weakened by shared form',()=>{
 const text=fragment('function v3SharedDraftErrors(m){','let v3SharedPublishBusy');
 const ctx={};vm.runInNewContext(text,ctx);
 assert.equal(ctx.v3SharedDraftErrors(valid).length,0);
 assert(ctx.v3SharedDraftErrors({...valid,ladderMode:'ranked'}).length>0);
 assert(ctx.v3SharedDraftErrors({...valid,registrationCapacity:320}).length>0);
 assert(ctx.v3SharedDraftErrors({...valid,waitlistCapacity:8}).length>0);
});
test('publishing a local V3 draft uses only V3 create and publish services',async()=>{
 const text=fragment('function v3SharedDraftErrors(m){','async function publishRegistrationConfig(){');
 const state={id:'draft',meta:valid,registrationFlowVersion:3,players:[],matches:[]},calls=[];
 const ctx={state,isSuperAdmin:()=>true,currentAuthUid:()=> 'admin',saveRecord:async()=>true,window:{engagementService:{
 createRegistrationRoomV3:async payload=>{calls.push(['create',payload]);return {ok:true,code:'BXH-TEST01'};},
 registrationV3Operation:async payload=>{calls.push(['publish',payload]);return {ok:true};}}},
 resolveAndJoinTournamentByCode:async()=>({ok:true}),appPhase:'app',activeTab:'settings',publicTournamentsCache:[],render(){},showToast(){},mapRegistrationError:e=>e.message};
 vm.runInNewContext(text,ctx);await ctx.publishV3SharedDraft();
 assert.equal(calls.length,2);assert.equal(calls[0][1].capacity,128);assert.equal(calls[1][1].action,'publishRoom');
 assert.equal(state.cloudCode,'BXH-TEST01');
});
