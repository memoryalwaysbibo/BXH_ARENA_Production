'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createService}=require('../functions/service.cjs');
const {MockDB,fixture}=require('./mock-db.cjs');
const request={auth:{uid:'alice'},data:{action:'get'}};
const read=async(seed,options={})=>{const db=new MockDB(seed),handle=createService(db,{clock:()=>10000,...options});return {db,handle,snapshot:(await handle(request)).snapshot};};
function changeRoom(seed,callback){const room=seed['tournaments/BXH-AAAA'],state=JSON.parse(room.data);callback(state,room);room.data=JSON.stringify(state);return seed;}
test('forged self logs cannot create credit for a match actually confirmed by someone else',async()=>{
  const {snapshot}=await read(fixture({confirmedUid:'bob'}));assert.equal(snapshot.stats.decisions,0);assert.equal(snapshot.certificate,null);assert.equal(snapshot.systemRecords[0].reason,'different-confirming-referee');
});
test('old unavailable logs stay pending and are not silently deleted or counted',async()=>{
  const seed=fixture();delete seed['tournaments/BXH-AAAA'];const {db,snapshot}=await read(seed);
  assert.equal(snapshot.stats.pendingLogCount,1);assert.equal(snapshot.stats.decisions,0);assert.equal(snapshot.certificate,null);assert.ok(db.read('staffActivityLogs/alice/matches/BXH-AAAA_m0'));
  const missingAuthority=await read(changeRoom(fixture(),(state,room)=>{delete room.eventAuthority;delete state.meta.eventAuthority;}));
  assert.equal(missingAuthority.snapshot.stats.pendingLogCount,1);assert.equal(missingAuthority.snapshot.stats.excludedLogCount,0);assert.equal(missingAuthority.snapshot.systemRecords[0].reason,'event-authority-unresolved');
});
test('verified decisions count during play, while event size and achievements await completion',async()=>{
  const {snapshot}=await read(fixture({size:320,archived:false}));assert.equal(snapshot.stats.systemDecisions,1);assert.equal(snapshot.stats.eventCount,0);assert.equal(snapshot.stats.pendingEvents,1);assert.equal(snapshot.stats.pendingLogCount,0);assert.equal(snapshot.systemRecords[0].status,'pending_event');assert.equal(snapshot.stats.milestones[300],0);
});
test('320 actual entrants cover lower thresholds once; capacity and bracket size do not substitute',async()=>{
  const {snapshot}=await read(fixture({size:320,decisions:3,roomExtra:{capacity:1000},stateExtra:{bracketSize:512}}));
  assert.equal(snapshot.stats.decisions,3);assert.equal(snapshot.stats.eventCount,1);assert.deepEqual(snapshot.stats.scales,{64:1,96:1,128:1});assert.equal(snapshot.stats.milestones[300],1);assert.equal(snapshot.stats.milestones[400],0);assert.equal(snapshot.stats.knownMaxSize,320);
});
test('unconfirmed event scale stays unknown rather than using room capacity',async()=>{
  const {snapshot}=await read(changeRoom(fixture({roomExtra:{capacity:320}}),state=>{state.players=[];}));
  assert.equal(snapshot.stats.eventCount,1);assert.equal(snapshot.stats.unknownScaleEvents,1);assert.equal(snapshot.stats.knownMaxSize,0);assert.equal(snapshot.stats.milestones[100],0);
});
test('known test events, byes and withdrawn decisions do not become official credit',async()=>{
  for(const mutate of [(s,r)=>{r.testMode=true;},s=>{s.matches[0].isBye=true;},s=>{s.matches[0].completed=false;},(s,r)=>{r.eventCancelled=true;}]){
    const {snapshot}=await read(changeRoom(fixture(),mutate));assert.equal(snapshot.stats.decisions,0);assert.equal(snapshot.certificate,null);
  }
});
test('trusted score audit fallback must match current confirmation time and score revision',async()=>{
  const seed=changeRoom(fixture(),s=>{delete s.matches[0].confirmedByUid;});
  seed['tournaments/BXH-AAAA/refereeScoreAudit/a1']={uid:'alice',action:'confirm',matchId:'m0',scoreRevision:1,at:1000};
  assert.equal((await read(seed)).snapshot.stats.decisions,1);
  seed['tournaments/BXH-AAAA/refereeScoreAudit/a1'].scoreRevision=0;
  const stale=(await read(seed)).snapshot;assert.equal(stale.stats.decisions,0);assert.equal(stale.stats.pendingLogCount,1);
});
test('cross-document duplicate logs count one match only',async()=>{
  const seed=fixture();seed['staffActivityLogs/alice/matches/duplicate']=seed['staffActivityLogs/alice/matches/BXH-AAAA_m0'];const {snapshot}=await read(seed);
  assert.equal(snapshot.stats.decisions,1);assert.equal(snapshot.stats.eventCount,1);assert.equal(snapshot.stats.excludedLogCount,1);
});
test('source limits expose incomplete and prevent automatic L1 and official grant',async()=>{
  const {db,handle,snapshot}=await read(fixture({decisions:20}),{limits:{logs:10}});
  assert.equal(snapshot.incomplete,true);assert.ok(snapshot.incompleteReasons.includes('logs-limit'));assert.equal(snapshot.certificate,null);assert.equal(db.read('refereeCertificateSystem/numbering'),undefined);
  db.put('refereeCertificates/alice',{number:'R000001',awardedLevel:1,revision:1,issuedAt:1});
  await assert.rejects(handle({auth:{uid:'admin'},data:{action:'grant',targetUid:'alice',operationId:'incomplete_grant',expectedRevision:1,level:2}}),e=>e.message==='sources-incomplete');
});
test('archived ranked event does not depend on ladder payment; byes do not block completion',async()=>{
  const seed=changeRoom(fixture(),s=>{s.meta.ladderMode='ranked';s.ladderPointsAwarded=false;s.matches.push({id:'bye',isBye:true,completed:false});});
  const {snapshot}=await read(seed);assert.equal(snapshot.stats.eventCount,1);assert.equal(snapshot.stats.pendingEvents,0);
});
