'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('../../modules/scoring/four-court-app-bridge.cjs');
function setup(){let uid='ref',calls=0,legacyReads=0;const state={id:'room',cloudCode:'BXH-BRIDGE1',meta:{refereeSeatsV1:{version:1}},matches:[{id:'m1',scoreA:0,refereeSeatScoreRevision:0}]};const client={getView:()=>({status:'ready',state}),score:async()=>{calls++;return {ok:true,scoreRevision:1};},manageRefereeSeats:async()=>({ok:true})};const bridge=create({client,code:state.cloudCode,uid,getUid:()=>uid,legacy:{joinRoom:async()=>{legacyReads++;return {ok:true,data:{stale:true}};}},timeoutMs:1000});return {state,bridge,setUid:next=>uid=next,calls:()=>calls,legacyReads:()=>legacyReads};}
test('existing command bridge returns full state only after authoritative revision arrives',async()=>{
 const h=setup();let settled=false;const promise=h.bridge.cloud.commitRefereeCommand({code:h.state.cloudCode,matchId:'m1',action:'score'}).then(r=>{settled=true;return r;});await Promise.resolve();assert.equal(settled,false);
 h.state.matches[0]={id:'m1',scoreA:1,refereeSeatScoreRevision:1};h.bridge.publish({status:'ready',state:h.state});const result=await promise;assert.equal(result.state.matches[0].scoreA,1);assert.equal(h.legacyReads(),0);
});
test('recovery reads the composed view and unsupported dispatch never falls back',async()=>{
 const h=setup();assert.equal((await h.bridge.cloud.joinRoom(h.state.cloudCode)).data.matches[0].scoreA,0);assert.equal(h.legacyReads(),0);
 assert.equal((await h.bridge.cloud.commitRefereeCommand({code:h.state.cloudCode,action:'unknown-dispatch'})).reason,'unsupported-bucket-action');assert.equal(h.calls(),0);
});
test('account switch drops a delayed success and does not expose state through recovery',async()=>{
 const h=setup(),promise=h.bridge.cloud.commitRefereeCommand({code:h.state.cloudCode,matchId:'m1',action:'score'});await Promise.resolve();h.setUid('other');h.bridge.publish({status:'ready',state:h.state});assert.equal((await promise).ok,false);assert.equal((await h.bridge.cloud.joinRoom(h.state.cloudCode)).ok,false);h.bridge.close();
});
test('retry forwards the retained key and waits for the authoritative score or seat revision',async()=>{
 const state={cloudCode:'BXH-RETRY6',meta:{refereeSeatsV1:{revision:0}},matches:[{id:'m1',refereeSeatScoreRevision:0}]},keys=[];
 const client={getView:()=>({status:'ready',state,retryable:['score:m1','seat']}),retry:async key=>{keys.push(key);return key==='seat'?{ok:true,revision:1}:{ok:true,scoreRevision:1};}};
 const bridge=create({client,code:state.cloudCode,uid:'ref',getUid:()=> 'ref',timeoutMs:1000});
 let done=false;const score=bridge.cloud.retryBucketOperation({code:state.cloudCode,key:'score:m1'}).then(result=>{done=true;return result;});await Promise.resolve();assert.equal(done,false);state.matches[0].refereeSeatScoreRevision=1;bridge.publish({status:'ready',state});assert.equal((await score).ok,true);
 done=false;const seat=bridge.cloud.retryBucketOperation({code:state.cloudCode,key:'seat'}).then(result=>{done=true;return result;});await Promise.resolve();assert.equal(done,false);state.meta.refereeSeatsV1.revision=1;bridge.publish({status:'ready',state});assert.equal((await seat).ok,true);assert.deepEqual(keys,['score:m1','seat']);
 assert.equal((await bridge.cloud.retryBucketOperation({code:state.cloudCode,key:'score:missing'})).reason,'nothing-to-retry');assert.equal((await bridge.cloud.retryBucketOperation({code:'BXH-OTHER6',key:'seat'})).reason,'bucket-session-mismatch');bridge.close();
});
test('dispatch and retry success wait for the root lifecycle revision rather than only a moved match score',async()=>{
 const state={cloudCode:'BXH-DISPATCH',courtLifecycleEpoch:0,meta:{},matches:[]},sent=[];
 const client={getView:()=>({status:'ready',state,retryable:['dispatch']}),dispatch:async data=>{sent.push(data);return {ok:true,lifecycleRevision:1};},retry:async key=>{sent.push(key);return {ok:true,lifecycleRevision:2};}};
 const bridge=create({client,code:state.cloudCode,uid:'ref',getUid:()=> 'ref',timeoutMs:1000});let done=false;
 const first=bridge.cloud.commitRefereeCommand({code:state.cloudCode,action:'reopen',station:1}).then(r=>{done=true;return r;});await Promise.resolve();assert.equal(done,false);state.courtLifecycleEpoch=1;bridge.publish({status:'ready',state});assert.equal((await first).state.courtLifecycleEpoch,1);
 done=false;const retry=bridge.cloud.retryBucketOperation({code:state.cloudCode,key:'dispatch'}).then(r=>{done=true;return r;});await Promise.resolve();assert.equal(done,false);state.courtLifecycleEpoch=2;bridge.publish({status:'ready',state});assert.equal((await retry).state.courtLifecycleEpoch,2);assert.equal(sent[1],'dispatch');bridge.close();
});
test('a match literally named dispatch still waits for its score revision',async()=>{
 const h=setup();h.state.matches[0].id='dispatch';const pending=h.bridge.cloud.commitRefereeCommand({code:h.state.cloudCode,action:'score',matchId:'dispatch'});await Promise.resolve();h.state.matches[0].refereeSeatScoreRevision=1;h.bridge.publish({status:'ready',state:h.state});assert.equal((await pending).ok,true);h.bridge.close();
});

