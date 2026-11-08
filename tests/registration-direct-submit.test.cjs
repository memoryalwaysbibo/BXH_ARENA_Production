'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const family=fs.readFileSync(path.join(root,'family-ui.js'),'utf8');
const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');
const start=family.indexOf('async function chooseFamilyParticipant(');
const end=family.indexOf('// v13.40.0',start);
const methodStart=cloud.indexOf('    async joinTournamentAsPlayer(');
const methodEnd=cloud.indexOf('\n    },',methodStart);
assert(start>=0&&end>start&&methodStart>=0&&methodEnd>methodStart);
const chooser=family.slice(start,end);
const join=cloud.slice(methodStart,methodEnd+6);

for(const [label,room,result] of [
 ['confirmed',{capacity:40,confirmedCount:39},{ok:true,status:'confirmed',rows:[{status:'confirmed'}]}],
 ['waitlist',{capacity:40,confirmedCount:40,waitlistEnabled:true,waitlistCapacity:8,waitlistCount:0},{ok:true,status:'waitlist',rows:[{status:'waitlist'}]}],
 ['unlimited',{capacity:null,communityQuickRegistration:true},{ok:true,status:'confirmed',rows:[{status:'confirmed'}]}],
 ['full',{capacity:40,confirmedCount:40,waitlistEnabled:true,waitlistCapacity:8,waitlistCount:8},Error('full')],
]){
 test(`self registration ${label} submits one join without preflight`,async()=>{
  const calls=[];
  const window={engagementService:{familyRegistration:async payload=>{
   calls.push(payload);
   if(payload.action!=='join')throw Error('unexpected-preflight');
   if(result instanceof Error)throw result;
   return result;
  }}};
  const context=vm.createContext({window,authReady:true,authHandle:{currentUser:{uid:'player-1'}},
   currentAuthUid:()=> 'player-1',engagementSessionEpoch:1,dbHandle:{},
   fx:{doc:()=>({}),getDoc:async()=>({exists:()=>true,data:()=>({...room,battleMode:'individual'})})},
   getPlayerRegistrationFeedback:()=>null,runMyEventsPlayerOperation:async(_route,_code,send)=>send('operation-123'),
   crypto:{randomUUID:()=> 'operation-123'}});
  vm.runInContext(`${chooser}\nwindow.api={${join}};`,context);
  if(result instanceof Error){
   await assert.rejects(context.window.api.joinTournamentAsPlayer('BXH-FIXTURE',true),/full/);
  }else{
   const response=await context.window.api.joinTournamentAsPlayer('BXH-FIXTURE',true);
   assert.equal(response.status,result.status);
  }
  assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{
   action:'join',code:'BXH-FIXTURE',childIds:[null],childEligibilityConfirmed:true,operationId:'operation-123'
  });
 });
}
