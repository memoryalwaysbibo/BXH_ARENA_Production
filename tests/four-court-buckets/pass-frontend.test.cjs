'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const common=require('../../modules/scoring/four-court-app-bridge.cjs');
const browser={setTimeout,clearTimeout,queueMicrotask};vm.createContext(browser);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../modules/scoring/four-court-browser.js'),'utf8'),browser);
for(const [label,api] of [['source',common],['served browser asset',browser.BXHFourCourtAppBridge]]){
 test(label+': PASS reaches dispatch once and waits for lifecycle acknowledgement',async()=>{
  const state={cloudCode:'BXH-PASSUI',courtLifecycleEpoch:0,meta:{},matches:[{id:'m1',refereeSeatScoreRevision:0}]},sent=[];
  const client={getView:()=>({status:'ready',state}),score:async()=>{throw Error('PASS incorrectly routed to score');},dispatch:async data=>{sent.push(data);return {ok:true,lifecycleRevision:1,scoreRevision:1};}};
  const bridge=api.create({client,code:state.cloudCode,uid:'ref',getUid:()=> 'ref',timeoutMs:1000});
  try{
   const data={code:state.cloudCode,action:'skip',matchId:'m1',station:1,operationId:'pass-ui-operation-0001',expectedCourtRevision:1,expectedScoreRevision:0,expectedDispatchRevision:0};
   let settled=false;const pending=bridge.cloud.commitRefereeCommand(data).then(value=>{settled=true;return value;});
   await Promise.resolve();assert.equal(sent.length,1);assert.strictEqual(sent[0],data);assert.equal(settled,false);
   state.matches[0].refereeSeatScoreRevision=1;bridge.publish({status:'ready',state});await Promise.resolve();assert.equal(settled,false,'score acknowledgement cannot finish structural PASS');
   state.courtLifecycleEpoch=1;state.matches[0].skippedAt=123;bridge.publish({status:'ready',state});
   const result=await pending;assert.equal(result.ok,true);assert.equal(result.state.matches[0].skippedAt,123);assert.equal(sent.length,1);
   assert.equal((await bridge.cloud.commitRefereeCommand({...data,action:'unknown-action'})).reason,'unsupported-bucket-action');assert.equal(sent.length,1);
  }finally{bridge.close();}
 });
}
