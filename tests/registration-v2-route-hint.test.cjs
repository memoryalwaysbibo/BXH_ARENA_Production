'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cloud=fs.readFileSync(require.resolve('../modules/cloud/cloud-runtime.js'),'utf8');
const start=cloud.indexOf('  const registrationV2RouteHints=new Map();');
const end=cloud.indexOf('  const managementQueueOperations=new Map();',start);
assert(start>=0&&end>start);
const source=cloud.slice(start,end);

function fixture(){
 let uid='parent',epoch=1,now=100000,serverReads=0;
 const context=vm.createContext({
  window:{BXH_REGISTRATION_FLOW_V2_ROOMS:[]},
  authHandle:{currentUser:{uid}},engagementSessionEpoch:epoch,dbHandle:{},
  fx:{doc:()=>({}),getDocFromServer:async()=>{serverReads++;return {exists:()=>true,data:()=>({registrationQueueVersion:2})};}},
  withTimeout:promise=>promise,Date:{now:()=>now},Map,Set,Error
 });
 vm.runInContext(source+'\nthis.route={rememberRegistrationV2Route,registrationFlowV2Enabled};',context);
 return {context,route:context.route,reads:()=>serverReads,setUid:value=>{uid=value;context.authHandle.currentUser.uid=value;},
  setEpoch:value=>{epoch=value;context.engagementSessionEpoch=value;},advance:ms=>{now+=ms;}};
}

test('a recent V2 public room read removes duplicate server route reads',async()=>{
 const f=fixture();f.route.rememberRegistrationV2Route('BXH-XXDNAH',{registrationQueueVersion:2});
 assert.equal(await f.route.registrationFlowV2Enabled('BXH-XXDNAH'),true);
 assert.equal(await f.route.registrationFlowV2Enabled('BXH-XXDNAH'),true);
 assert.equal(f.reads(),0);
});
test('unknown rooms and non-V2 documents never create a route hint',async()=>{
 const f=fixture();f.route.rememberRegistrationV2Route('BXH-XXDNAH',{registrationQueueVersion:1});
 assert.equal(await f.route.registrationFlowV2Enabled('BXH-XXDNAH'),true);
 assert.equal(f.reads(),1);
 f.route.rememberRegistrationV2Route('BXH-OTHER1',{registrationQueueVersion:2});
 assert.equal(await f.route.registrationFlowV2Enabled('BXH-OTHER1'),false);
 assert.equal(f.reads(),1);
});
test('account, session, and age changes invalidate the route hint',async()=>{
 const f=fixture();f.route.rememberRegistrationV2Route('BXH-XXDNAH',{registrationQueueVersion:2});
 f.setUid('another');assert.equal(await f.route.registrationFlowV2Enabled('BXH-XXDNAH'),true);assert.equal(f.reads(),1);
 f.setUid('parent');f.setEpoch(2);assert.equal(await f.route.registrationFlowV2Enabled('BXH-XXDNAH'),true);assert.equal(f.reads(),2);
 f.route.rememberRegistrationV2Route('BXH-XXDNAH',{registrationQueueVersion:2});f.advance(30000);
 assert.equal(await f.route.registrationFlowV2Enabled('BXH-XXDNAH'),true);assert.equal(f.reads(),3);
});

test('a populated pilot room previews and submits without repeated server route reads',async()=>{
 const family=fs.readFileSync(require.resolve('../family-ui.js'),'utf8');
 const chooser=family.slice(family.indexOf('async function chooseFamilyParticipant('),family.indexOf('// v13.40.0'));
 const methodStart=cloud.indexOf('    async joinTournamentAsPlayer(');
 const join=cloud.slice(methodStart,cloud.indexOf('\n    },',methodStart)+6);
 const calls=[];let serverReads=0;
 const room={battleMode:'individual',registrationQueueVersion:2,capacity:20,confirmedCount:2,bracketView:JSON.stringify({players:[{},{}]})};
 const context=vm.createContext({window:{BXH_REGISTRATION_FLOW_V2_ROOMS:[]},
  authReady:true,authHandle:{currentUser:{uid:'parent'}},engagementSessionEpoch:1,
  currentAuthUid:()=> 'parent',dbHandle:{},withTimeout:promise=>promise,
  fx:{doc:()=>({}),getDoc:async()=>({exists:()=>true,data:()=>room}),
   getDocFromServer:async()=>{serverReads++;return {exists:()=>true,data:()=>room};}},
  getPlayerRegistrationFeedback:()=>null,runMyEventsPlayerOperation:async(_route,_code,send)=>send('original-operation-123'),
  crypto:{randomUUID:()=> 'original-operation-123'}});
 vm.runInContext(source+'\n'+chooser+'\nthis.join={'+join+'};',context);
 context.window.engagementService={registrationFlowV2Enabled:context.registrationFlowV2Enabled,
  familyRegistration:async payload=>{
   calls.push(payload.action);
   if(payload.action==='preview')return {ok:true,allocation:[{registrationId:'parent',status:'confirmed'}]};
   return {ok:true,status:'confirmed'};
  }};
 assert.equal((await context.join.joinTournamentAsPlayer('BXH-XXDNAH',true)).status,'confirmed');
 assert.deepEqual(calls,['preview','join']);
 assert.equal(serverReads,0);
});
