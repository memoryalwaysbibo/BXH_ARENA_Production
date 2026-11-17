'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.BXH_ROUND_GATE_TEST_ROOT||path.join(__dirname,'..');
const {createEngine}=require(path.join(root,'referee-seats/functions/engine/index.cjs'));
const scoring=require(path.join(root,'referee-seats/functions/scoring-core.cjs'));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const core=read('modules/main-app/core.js');
function extract(name){
 const start=core.indexOf('function '+name+'(');assert(start>=0,name);
 const next=/\n(?:async )?function /.exec(core.slice(start+1));assert(next,name+' end');
 return core.slice(start,start+1+next.index);
}
function fixture(meta={}){
 const match=(r,i,station)=>({id:`r${r}m${i}`,bracket:'SE',round:r,indexInRound:i,seq:r*4+i,station,
  a:r?null:{type:'player',playerId:'p'+i*2},b:r?null:{type:'player',playerId:'p'+(i*2+1)},
  status:'pending',completed:false,isBye:false,scoreA:0,scoreB:0,log:[],faultActions:[],scoringMode:'standard'});
 const matches=[match(0,0,1),match(0,1,1),match(0,2,2),match(0,3,2),match(1,0,1),match(1,1,2),match(2,0,1)];
 for(const m of matches.slice(0,2))Object.assign(m,{completed:true,status:'completed',winnerId:m.a.playerId,loserId:m.b.playerId});
 matches[2].status='in_progress';
 matches[4].a={type:'player',playerId:'p0'};matches[4].b={type:'player',playerId:'p2'};
 return {id:'round-gate',meta:{formatType:'single',stations:3,scoringMode:'standard',eventAuthority:'official',...meta},
  startedAt:1,bracketSize:8,players:Array.from({length:8},(_,i)=>({id:'p'+i,name:'p'+i})),matches,
  courtAssignments:{court1:{currentMatchId:null,nextMatchId:null},court2:{currentMatchId:'r0m2',nextMatchId:'r0m3'},court3:{currentMatchId:null,nextMatchId:null}}};
}
const byId=(st,id)=>st.matches.find(m=>m.id===id);
function browser(st){
 const ctx={window:{},state:st};vm.createContext(ctx);
 for(const f of ['modules/main-app/match-utils.js','modules/main-app/court-retirement.js'])vm.runInContext(read(f),ctx);
 const names=['rebuildPropagation','rebuildPropagationForState','syncMatchStatuses','autoAdvanceReadyMatches',
 'stationExecutionQueue','rebuildCourtAssignments','reconcileCourtAssignments','idleCourtCandidates','applyIdleCourtClaim','clearCourtAssignmentRefs',
 'rebuildPropagationSingle','singleElimScheduleTier','singleElimBronzeGatePhase','singleElimBronzeBeforeFinalBlocked',
 'activeSingleElimSchedulePhase','isInActiveSingleElimPhase','applyPropagatedSlots','getMatch','orderedMatches',
 'refereeMatches','matchesInRound','numRoundsTotal','ensureMatchStatusFields','resolveScoringModeForRound',
 'ensureMatchScoringFields','tournamentEligiblePlayers','applyChallongeSingleElimOrder','canManualAssignMatch','canCourtSwapTarget'];
 for(const n of ['singleElimRoundDispatchBlocked','singleElimDispatchBlocked'])if(core.includes('function '+n+'('))names.push(n);
 vm.runInContext('const {courtKey,matchHasDecisionData}=window.BXHMatchUtils;\n'+names.map(extract).join('\n'),ctx);
 return ctx;
}
function server(st){return createEngine(st,{uid:'ref',name:'Ref'},100,'round-order-test');}
for(const [label,make] of [['browser',browser],['server',server]]){
 for(const [room,meta] of [['積分',{ladderMode:'ranked'}],['一般',{ladderMode:'general'}],['玩家一般',{eventAuthority:'community',ladderMode:'general',ownerUid:'player'}]]){
  test(`${label}: ${room} starts waiting prior-round work before releasing a later round`,()=>{
   const st=fixture(meta);make(st).rebuildPropagationForState(st);
   assert.equal(byId(st,'r0m3').status,'in_progress');
   assert(Object.values(st.courtAssignments).some(c=>c.currentMatchId==='r0m3'));
   if(byId(st,'r1m0').status==='in_progress')assert(st.matches.filter(m=>m.round===0&&!m.completed).every(m=>m.status==='in_progress'));
  });
  test(`${label}: ${room} releases next round while earlier matches are still playing`,()=>{
   const st=fixture(meta);byId(st,'r0m3').status='in_progress';byId(st,'r0m3').station=3;
   st.courtAssignments.court2.nextMatchId=null;st.courtAssignments.court3.currentMatchId='r0m3';
   make(st).rebuildPropagationForState(st);
   assert.equal(byId(st,'r1m0').status,'in_progress');
   assert.equal(st.courtAssignments.court1.currentMatchId,'r1m0');
   assert.equal(byId(st,'r0m2').completed,false);assert.equal(byId(st,'r0m3').completed,false);
  });
 }
 for(const [condition,patch] of [['paused',{status:'paused'}],['PASS',{status:'pending',skippedAt:10,callPass:{waitFor:['r0m2']},skipWaitFor:['r0m2']}],['missing pair',{status:'pending',b:null}],['stale PASS in_progress',{status:'in_progress',skippedAt:10,callPass:{waitFor:['r0m2']}}]]){
  test(`${label}: ${condition} blocks later-round auto dispatch`,()=>{
   const st=fixture();Object.assign(byId(st,'r0m3'),patch);
   // A paused current match must remain on its court, without starting a later round elsewhere.
   if(condition==='paused'){byId(st,'r0m2').status='paused';st.courtAssignments.court2.currentMatchId='r0m3';}
   make(st).rebuildPropagationForState(st);
   assert.notEqual(byId(st,'r1m0').status,'in_progress');
  });
 }
 test(`${label}: an idle court can claim a same-round unreserved match, then unlock the next round`,()=>{
  const st=fixture();st.courtAssignments.court2.nextMatchId=null;
  const engine=make(st);assert.equal(engine.applyIdleCourtClaim(st,'r0m3',1).ok,true);
  assert.equal(byId(st,'r0m3').station,1);
  assert.equal(st.courtAssignments.court1.currentMatchId,'r0m3');
  assert.notEqual(byId(st,'r1m0').status,'in_progress');
  engine.rebuildPropagationForState(st);
  assert.equal(byId(st,'r0m3').status,'in_progress');
  engine.rebuildPropagationForState(st);
  assert.equal(byId(st,'r1m0').status,'in_progress');
  const ids=Object.values(st.courtAssignments).map(c=>c.currentMatchId).filter(Boolean);
  assert.equal(new Set(ids).size,ids.length);
 });
 test(`${label}: preassigned future ready/current and next pointers cannot bypass a waiting round`,()=>{
  const st=fixture();st.courtAssignments.court1={currentMatchId:'r1m0',nextMatchId:'r1m1'};byId(st,'r1m0').status='ready';
  make(st).rebuildPropagationForState(st);
  assert.equal(st.courtAssignments.court1.currentMatchId,'r0m3');assert.notEqual(st.courtAssignments.court1.nextMatchId,'r1m1');
  assert.notEqual(st.courtAssignments.court1.currentMatchId,'r1m0');
 });
 test(`${label}: ongoing later-round play survives an earlier pause`,()=>{
  const st=fixture();byId(st,'r0m3').status='paused';byId(st,'r1m0').status='in_progress';byId(st,'r1m0').scoreA=1;
  st.courtAssignments.court1.currentMatchId='r1m0';
  make(st).rebuildPropagationForState(st);
  assert.equal(st.courtAssignments.court1.currentMatchId,'r1m0');assert.equal(byId(st,'r1m0').scoreA,1);
 });
 test(`${label}: a bye does not hold up the next round`,()=>{
  const st=fixture();byId(st,'r0m3').isBye=true;byId(st,'r0m3').b=null;
  make(st).rebuildPropagationForState(st);assert.equal(byId(st,'r1m0').status,'in_progress');
 });
}
test('browser: manual assignment, swap, idle claim and reconciliation use the same round gate',()=>{
 const st=fixture(),ctx=browser(st),next=byId(st,'r1m0');
 assert.equal(ctx.canManualAssignMatch(next,st),false);
 assert.equal(ctx.canCourtSwapTarget(next,byId(st,'r0m3'),st),false);
 assert.equal(ctx.applyIdleCourtClaim(st,next.id,3).ok,false);
 st.courtAssignments.court1.currentMatchId=next.id;next.dispatchRevision=1;next.status='ready';
 ctx.reconcileCourtAssignments();assert.notEqual(st.courtAssignments.court1.currentMatchId,next.id);
});
test('server: an idle claim cannot select a later-round match from another court',()=>{
 const st=fixture();assert.equal(server(st).applyIdleCourtClaim(st,'r1m0',3).ok,false);
});
test('server: stale manual start/ready commands recheck the current round',()=>{
 for(const action of ['start','ready']){
  const st=fixture(),m=byId(st,'r1m0');
  const room={eventAuthority:'official',createdBy:'host',assignedStaffUids:['ref'],refereeSeatsV1:{version:1,courts:{1:{revision:1,main:{uid:'ref'}}}}};
  const d={action,operationId:'round-gate-command',station:1,matchId:m.id,expectedCourtRevision:1,expectedScoreRevision:0,expectedDispatchRevision:0,playerAId:'p0',playerBId:'p2'};
  const snapshot=JSON.stringify(st);
  assert.throws(()=>scoring.transition({room,state:st,user:{active:true,role:'staff'},uid:'ref',d,now:100}),/previous-round-waiting/);
  assert.equal(JSON.stringify(st),snapshot);
 }
});
test('a waiting match two rounds earlier cannot be bypassed by a later ready pair',()=>{
 for(const make of [browser,server]){
  const st=fixture(),m=byId(st,'r2m0');m.a={playerId:'p0'};m.b={playerId:'p4'};
  const ctx=make(st);
  if(ctx.singleElimRoundDispatchBlocked)assert.equal(ctx.singleElimRoundDispatchBlocked(m,st.matches,st.meta),true);
  assert.equal(ctx.applyIdleCourtClaim(st,m.id,3).ok,false);
 }
});
test('retiring-court held queues still honor round order',()=>{
 const st=fixture();st.meta.stations=3;
 st.courtRetirementPlan={targetCount:2,courts:{3:{holdIds:['r1m0']}},status:'draining',revision:1};
 byId(st,'r1m0').station=3;
 const ctx=browser(st);assert(!ctx.stationExecutionQueue(3).some(m=>m.id==='r1m0'));
});
for(const [players,courts] of [[24,4],[128,6],[320,12]])test(`server: full synthetic ${players}-player/${courts}-court bracket completes in round order`,()=>{
 const st={id:'synthetic-order',meta:{formatType:'single',stations:courts,scoringMode:'standard'},startedAt:null,
  players:Array.from({length:players},(_,i)=>({id:'p'+i})),matches:[],courtAssignments:{}};
 const engine=createEngine(st,{uid:'test',name:'Test'},100,'synthetic-bracket','round-order-seed');
 assert.equal(engine.generateSingleElim(),true);st.startedAt=1;
 let played=0;
 for(let step=0;step<players+2;step++){
  const priorRunning=new Set(st.matches.filter(m=>m.status==='in_progress').map(m=>m.id));
  engine.rebuildPropagationForState(st);
  const newlyRunning=st.matches.filter(m=>m.status==='in_progress'&&!priorRunning.has(m.id));
  for(const m of newlyRunning){
   assert(m.a&&m.b);
   const waiting=st.matches.filter(x=>x.bracket==='SE'&&!x.isBye&&!x.completed&&x.round<m.round&&x.status!=='in_progress');
   assert.equal(waiting.length,0,`round ${m.round} bypassed a waiting match`);
  }
  if(st.championId)break;
  const current=Object.values(st.courtAssignments).map(c=>byId(st,c.currentMatchId)).filter(m=>m&&!m.completed&&m.status==='in_progress');
  assert(current.length,'no deadlock');assert.equal(new Set(current.map(m=>m.id)).size,current.length);
  for(const m of newlyRunning){
   const overtaken=st.matches.filter(x=>!x.completed&&!x.isBye&&x.round===m.round&&x.a&&x.b&&x.status!=='in_progress'&&x.seq<m.seq);
   assert.equal(overtaken.length,0,'new work must not overtake a lower-sequence waiting pair');
  }
  // Vary which court finishes; always finishing the first hides routing bugs.
  const m=current.sort((a,b)=>a.seq-b.seq)[(step*7+3)%current.length];
  Object.assign(m,{completed:true,status:'completed',winnerId:m.a.playerId,loserId:m.b.playerId});played++;
 }
 assert(st.championId);assert.equal(played,players-1);
});
