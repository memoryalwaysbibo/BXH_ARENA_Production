'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const cloud=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');

function extractFunction(name){
  const start=cloud.indexOf('  async function '+name+'(');
  assert.ok(start>=0,name);
  const end=cloud.indexOf('\n  }',start);
  assert.ok(end>start,name);
  return cloud.slice(start,end+4);
}

test('PTN delegate search reaches the roster callable with App Check',async()=>{
  const calls=[];
  const context=vm.createContext({
    window:{BXH_TICKET_ROOM_PTN_PILOT:true},
    engagementSessionEpoch:1,firebaseUser:{uid:'owner'},authReady:true,
    authHandle:{currentUser:{uid:'owner'}},functionsHandle:{},
    fnx:{httpsCallable:(_handle,name)=>async payload=>{calls.push({name,payload});return {data:{ok:true,candidates:[]}};}},
    tryInitFirebase:async()=>true,withTimeout:promise=>promise,
    ensureHunterClashAppCheck:async()=>{calls.push('AppCheck');},
    ticketRegistrationPilot:()=>true,ENGAGEMENT_CALL_TIMEOUT_MS:30000
  });
  vm.runInContext(extractFunction('callEngagementFunction'),context);
  const start=cloud.indexOf('    async ticketRoomOperation(');
  const end=cloud.indexOf('\n    },',start);
  assert.ok(start>=0&&end>start);
  const operation=vm.runInContext('({'+cloud.slice(start,end+7).trim()+'})',context).ticketRoomOperation;
  const result=await operation({action:'ticket-room-delegate-search',code:'PTN-E50A3E',query:'郭鬼鬼'});
  assert.equal(result.ok,true);
  assert.equal(calls[0],'AppCheck');
  assert.equal(calls[1].name,'registrationRosterQueueV2');
  assert.equal(calls[1].payload.action,'ticket-room-delegate-search');
  assert.equal(calls[1].payload.code,'PTN-E50A3E');
  assert.equal(calls[1].payload.query,'郭鬼鬼');
});
