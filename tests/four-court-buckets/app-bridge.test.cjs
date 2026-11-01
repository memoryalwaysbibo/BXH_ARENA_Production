'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('../../modules/scoring/four-court-app-bridge.cjs');
function setup(){let uid='ref',calls=0,legacyReads=0;const state={id:'room',cloudCode:'BXH-BRIDGE1',meta:{refereeSeatsV1:{version:1}},matches:[{id:'m1',scoreA:0,refereeSeatScoreRevision:0}]};const client={getView:()=>({status:'ready',state}),score:async()=>{calls++;return {ok:true,scoreRevision:1};},manageRefereeSeats:async()=>({ok:true})};const bridge=create({client,code:state.cloudCode,uid,getUid:()=>uid,legacy:{joinRoom:async()=>{legacyReads++;return {ok:true,data:{stale:true}};}},timeoutMs:1000});return {state,bridge,setUid:next=>uid=next,calls:()=>calls,legacyReads:()=>legacyReads};}
test('existing command bridge returns full state only after authoritative revision arrives',async()=>{
 const h=setup();let settled=false;const promise=h.bridge.cloud.commitRefereeCommand({code:h.state.cloudCode,matchId:'m1',action:'score'}).then(r=>{settled=true;return r;});await Promise.resolve();assert.equal(settled,false);
 h.state.matches[0]={id:'m1',scoreA:1,refereeSeatScoreRevision:1};h.bridge.publish({status:'ready',state:h.state});const result=await promise;assert.equal(result.state.matches[0].scoreA,1);assert.equal(h.legacyReads(),0);
});
test('recovery reads the composed view and unsupported dispatch never falls back',async()=>{
 const h=setup();assert.equal((await h.bridge.cloud.joinRoom(h.state.cloudCode)).data.matches[0].scoreA,0);assert.equal(h.legacyReads(),0);
 assert.equal((await h.bridge.cloud.commitRefereeCommand({code:h.state.cloudCode,action:'manual-assign'})).reason,'unsupported-bucket-action');assert.equal(h.calls(),0);
});
test('account switch drops a delayed success and does not expose state through recovery',async()=>{
 const h=setup(),promise=h.bridge.cloud.commitRefereeCommand({code:h.state.cloudCode,matchId:'m1',action:'score'});await Promise.resolve();h.setUid('other');h.bridge.publish({status:'ready',state:h.state});assert.equal((await promise).ok,false);assert.equal((await h.bridge.cloud.joinRoom(h.state.cloudCode)).ok,false);h.bridge.close();
});
