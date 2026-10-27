'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {draw}=require('./helpers/rdw-production-draw.cjs');
const {buildRankedStartDispatch}=require('../scripts/lib/rdw-server-start-dispatch.cjs');
const {verifyStartDispatch}=require('../scripts/lib/rdw-start-dispatch-gate.cjs');
const {createEngine}=require('../referee-seats/functions/engine/index.cjs');
function active(state){return Object.values(state.courtAssignments).map(c=>state.matches.find(m=>m.id===c.currentMatchId)).filter(Boolean);}
function uniquePlayers(state){const ids=active(state).flatMap(m=>[m.a.playerId,m.b.playerId]);assert.equal(new Set(ids).size,ids.length,'same player assigned to two live courts');}
function start(state){return {...state,...buildRankedStartDispatch({state,eventCode:state.cloudCode,drawRevision:7,serverTime:200}),startedAt:200};}
for(const format of ['single','double','roundrobin'])for(const count of [2,3,5,8,16,32,128,141,320])for(const stations of [1,6]){
 test(`actual ${format} draw: ${count} players / ${stations} courts`,()=>{
  const before=draw({format,count,stations}),next=start(before);
  uniquePlayers(next);assert.ok(active(next).length>0);
  assert.ok(active(next).length<=Math.min(stations,Math.floor(count/2)));
  assert.deepEqual(next.matches.filter(m=>m.isBye),before.matches.filter(m=>m.isBye));
  assert.equal(verifyStartDispatch({before,after:next,requireLive:true,serverTime:200}).ok,true);
 });
}
for(const count of [3,5,8,16])test(`RR ${count}: asynchronous finishes never double-book or deadlock`,()=>{
 const state=start(draw({format:'roundrobin',count,stations:6}));
 let ticks=0;
 while(state.matches.some(m=>!m.completed)){
  uniquePlayers(state);const live=active(state);assert.ok(live.length,'unfinished matches must progress');
  // Finish one court at a time: other courts retain their players.
  const m=live[ticks%live.length];Object.assign(m,{completed:true,status:'completed',winnerId:m.a.playerId,loserId:m.b.playerId,scoreA:3,scoreB:0});
  createEngine(state,{uid:'ref'},201+ticks,'finish-'+ticks).rebuildPropagationForState(state);
  assert.ok(++ticks<=count*(count-1)/2);
 }
 uniquePlayers(state);assert.equal(ticks,count*(count-1)/2);
});
test('RR paused players remain reserved; manual and skipped dispatch refuse without mutation',()=>{
 const state=start(draw({format:'roundrobin',count:5,stations:6}));
 const held=active(state)[0];held.status='paused';
 const queued=state.matches.find(m=>!active(state).includes(m)&&!m.completed&&[m.a.playerId,m.b.playerId].includes(held.a.playerId));
 const target=Number(held.station)===1?2:1;
 const engine=createEngine(state,{uid:'ref'},300,'manual');let before=JSON.stringify(state);
 assert.equal(engine.applyManualCourtAssign(state,queued.id,target).reason,'player-busy');assert.equal(JSON.stringify(state),before);
 queued.skippedAt=250;queued.resumeQueuedAt=null;queued.dispatchRevision=0;before=JSON.stringify(state);
 assert.equal(engine.applySkippedDispatch(state,queued,target,0).reason,'player-busy');assert.equal(JSON.stringify(state),before);
 engine.rebuildPropagationForState(state);uniquePlayers(state);assert.equal(held.status,'paused');
});
test('start verifier independently rejects a player on two live courts',()=>{
 const before=draw({format:'roundrobin',count:8,stations:2}),after=start(before),live=active(after);
 live[1].a.playerId=live[0].a.playerId;
 assert.equal(verifyStartDispatch({before,after,requireLive:true,serverTime:200}).reason,'player-double-booked');
});
