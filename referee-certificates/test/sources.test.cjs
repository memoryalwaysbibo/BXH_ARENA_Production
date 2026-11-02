'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),S=require('../functions/sources.cjs');
const {MockDB,fixture}=require('./mock-db.cjs'),D=require('../functions/domain.cjs');
async function source(seed,limits=D.LIMITS){const db=new MockDB(seed);return db.runTransaction(tx=>S.readSystemSources(tx,db,'alice',limits));}
test('operator UID and exact score audit are not evidence of responsibility',async()=>{
 const seed=fixture();seed['tournaments/BXH-AAAA/refereeScoreAudit/one']={uid:'alice',matchId:'m0',action:'confirm',at:1000,scoreRevision:1};
 const s=await source(seed);assert.equal(s.decisions,0);assert.equal(s.pendingLogCount,1);assert.equal(s.systemRecords[0].reason,'responsibility-unverified');
});
test('final match in ongoing event remains eligible for explicit decision recognition',async()=>{
 const seed=fixture({archived:false});const s=await source(seed);assert.equal(s.systemRecords[0].finalResultValid,true);assert.equal(s.decisions,0);
});
test('test/cancelled/bye/revoked results excluded; role or seat never upgrades them',async()=>{
 for(const [roomPatch,matchPatch] of [[{testMode:true},{}],[{eventCancelled:true},{}],[{}, {isBye:true}],[{}, {revokedAt:100}],[{}, {completed:false}]]){
  const seed=fixture(),room=seed['tournaments/BXH-AAAA'],state=JSON.parse(room.data);Object.assign(state.matches[0],matchPatch);Object.assign(room,roomPatch,{data:JSON.stringify(state)});
  const s=await source(seed);assert.equal(s.decisions,0);assert.equal(s.excludedLogCount,1);
 }
});
test('unavailable and ambiguous authority stay pending, truncated logs mark incomplete',async()=>{
 const seed=fixture();delete seed['tournaments/BXH-AAAA'];let s=await source(seed);assert.equal(s.pendingLogCount,1);
 s=await source(fixture({decisions:2}),{...D.LIMITS,logs:1});assert.equal(s.incomplete,true);assert.equal(s.decisions,0);
});
test('exact canonical scale, inclusive thresholds and event completion retain original rules',()=>{
 const room=fixture({size:148})['tournaments/BXH-AAAA'],state=S.parseState(room);
 assert.equal(S.actualSize(state).size,148);assert.equal(S.completedEvent(room,state),true);
 state.archiveStatus='ongoing';assert.equal(S.completedEvent(room,state),false);
 state.meta.battleMode='team';assert.equal(S.actualSize(state).precision,'unknown');
});
test('rooms and logs bounds report independent reasons; unread rooms remain pending',async()=>{
 const seed={...fixture(),...fixture({code:'BXH-BBBB'})};
 const r=await source(seed,{...D.LIMITS,rooms:1});assert.equal(r.incomplete,true);assert.ok(r.incompleteReasons.includes('rooms-limit'));assert.ok(r.systemRecords.some(x=>x.reason==='room-not-read'));
 const l=await source(fixture({decisions:3}),{...D.LIMITS,logs:1});assert.ok(l.incompleteReasons.includes('logs-limit'));assert.equal(l.systemRecords.length,1);
});
test('missing authority invalid identity and duplicate logs remain distinguishable without deletion',async()=>{
 const seed=fixture(),room=seed['tournaments/BXH-AAAA'],state=JSON.parse(room.data);delete room.eventAuthority;delete state.meta.eventAuthority;room.data=JSON.stringify(state);
 let r=await source(seed);assert.equal(r.systemRecords[0].reason,'event-authority-unresolved');
 const duplicated=fixture();duplicated['staffActivityLogs/alice/matches/duplicate']=duplicated['staffActivityLogs/alice/matches/BXH-AAAA_m0'];
 r=await source(duplicated);assert.equal(r.excludedLogCount,1);assert.equal(r.pendingLogCount,1);
 duplicated['staffActivityLogs/alice/matches/forged']={uid:'bob',tournamentCode:'BXH-AAAA',matchId:'m0'};
 r=await source(duplicated);assert.ok(r.systemRecords.some(x=>x.reason==='invalid-log-identity'));
});
test('320 canonical entrants ignore capacity and padded bracket; unavailable roster never invents scale',()=>{
 const room=fixture({size:320,roomExtra:{capacity:1000},stateExtra:{bracketSize:512}})['tournaments/BXH-AAAA'],state=S.parseState(room);
 assert.equal(S.actualSize(state).size,320);state.players=[];assert.equal(S.actualSize(state).precision,'unknown');
});
test('completed ranked event ignores payment and bye completion, but unfinished real match blocks event',()=>{
 const state=S.parseState(fixture()['tournaments/BXH-AAAA']);state.meta.ladderMode='ranked';state.ladderPointsAwarded=false;state.matches.push({id:'bye',isBye:true,completed:false});
 assert.equal(S.completedEvent({},state),true);state.matches[0].completed=false;assert.equal(S.completedEvent({},state),false);
});
