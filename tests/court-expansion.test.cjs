'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.COURT_RESIZE_TEST_ROOT||path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const core=read('modules/main-app/core.js'),cloud=read('modules/cloud/cloud-runtime.js');
function extract(src,name,indent=''){
  const start=src.indexOf(indent+'function '+name+'(');
  assert(start>=0,name);
  const rest=src.slice(start+1);
  const next=new RegExp('\\n'+indent+'(?:async )?function ').exec(rest);
  assert(next,name+' end');
  return src.slice(start,start+1+next.index);
}
const names=['rebuildPropagation','rebuildPropagationForState','syncMatchStatuses','autoAdvanceReadyMatches',
 'roundRobinPlayersBusyElsewhere','stationExecutionQueue','rebuildCourtAssignments','idleCourtCandidates','applyIdleCourtClaim','clearCourtAssignmentRefs',
 'rebuildPropagationSingle','singleElimScheduleTier','singleElimBronzeGatePhase','singleElimBronzeBeforeFinalBlocked',
 'activeSingleElimSchedulePhase','isInActiveSingleElimPhase','applyPropagatedSlots','getMatch','orderedMatches',
 'refereeMatches','matchesInRound','numRoundsTotal','ensureMatchStatusFields','resolveScoringModeForRound',
 'ensureMatchScoringFields','tournamentEligiblePlayers','applyChallongeSingleElimOrder'];
const clone=x=>JSON.parse(JSON.stringify(x));
function harness(size=32,started=true){
 const st={meta:{stations:1,formatType:'single',bronzeMatch:false},startedAt:started?1:null,bracketSize:size,
  players:Array.from({length:size},(_,i)=>({id:'p'+i})),matches:[],courtAssignments:{},forcedCourtExits:{}};
 for(let r=0;r<Math.log2(size);r++)for(let i=0;i<size/2/(2**r);i++)st.matches.push({
  id:'r'+r+'m'+i,bracket:'SE',round:r,indexInRound:i,a:r?null:{type:'player',playerId:'p'+i*2},
  b:r?null:{type:'player',playerId:'p'+(i*2+1)},isBye:false,completed:false,scoreA:0,scoreB:0,
  log:[],faultActions:[],winnerId:null,loserId:null,status:'pending',station:1});
 const ctx={window:{BXHBracketCommit:require('../modules/main-app/bracket-commit.js')},state:st,console};
 vm.createContext(ctx);
 for(const f of ['modules/main-app/match-utils.js','modules/main-app/court-retirement.js','modules/main-app/qr-checkin-fence.js'])vm.runInContext(read(f),ctx);
 vm.runInContext('const {courtKey,matchHasDecisionData}=window.BXHMatchUtils;\n'+names.map(n=>extract(core,n)).join('\n'),ctx);
 ctx.applyChallongeSingleElimOrder(st.matches,1);ctx.rebuildPropagation();
 return {st,ctx,api:ctx.window.BXHCourtRetirement};
}
function resize(h,n){const {st,api}=h;const result=api.request(st,n,api.target(st),100,Number(st.courtRetirementPlan?.revision||0));assert(result.ok);h.ctx.rebuildPropagationForState(st);return result;}
const routing=st=>st.matches.map(m=>[m.id,m.station,Number(m.dispatchRevision||0)]);
const structure=st=>st.matches.map(m=>[m.id,m.seq,m.bracket,m.round,m.indexInRound,m.a,m.b,m.winnerId,m.loserId,m.scoreA,m.scoreB,m.log,m.faultActions]);
test('1→6 distributes current/next and future placeholders in one rebuild, preserving original current and next',()=>{
 const h=harness();h.st.matches[0].scoreA=2;const first=clone(h.st.matches[0]),oldNext=h.st.courtAssignments.court1.nextMatchId,slots=structure(h.st);
 resize(h,6);const cs=Object.values(h.st.courtAssignments);
 assert.equal(cs.length,6);assert(cs.every(c=>c.currentMatchId&&c.nextMatchId));assert.equal(new Set(cs.flatMap(c=>[c.currentMatchId,c.nextMatchId])).size,12);
 assert.deepEqual(clone(h.st.matches[0]),first);assert.equal(h.st.courtAssignments.court1.nextMatchId,oldNext);
 assert.deepEqual(structure(h.st),slots);assert.equal(new Set(h.st.matches.filter(m=>m.round>0).map(m=>m.station)).size,6);
 assert(h.st.matches.every(m=>Number(m.dispatchRevision||0)<=1));
});
test('1→6→6 is a routing and plan no-op; repeat rebuilds cannot steal reserved next',()=>{
 const h=harness();resize(h,6);const routes=routing(h.st),plan=clone(h.st.courtRetirementPlan),refs=clone(h.st.courtAssignments);
 resize(h,6);assert.deepEqual(routing(h.st),routes);assert.deepEqual(clone(h.st.courtRetirementPlan),plan);
 for(let i=0;i<6;i++)h.ctx.rebuildPropagationForState(h.st);
 assert.deepEqual(routing(h.st),routes);
 for(const k of Object.keys(refs))assert.deepEqual([h.st.courtAssignments[k].currentMatchId,h.st.courtAssignments[k].nextMatchId],[refs[k].currentMatchId,refs[k].nextMatchId]);
});
test('pre-start expansion distributes queues without starting the tournament or matches',()=>{
 const h=harness(32,false);resize(h,6);assert.equal(h.st.startedAt,null);
 assert(Object.values(h.st.courtAssignments).every(c=>c.currentMatchId&&c.nextMatchId));
 assert(h.st.matches.every(m=>m.status!=='in_progress'&&!m.startedAt));
});
test('insufficient unreserved pairs leaves courts idle instead of stealing notified next or duplicating current',()=>{
 const h=harness(4),next=h.st.courtAssignments.court1.nextMatchId;resize(h,6);
 assert.equal(h.st.courtAssignments.court1.nextMatchId,next);
 const current=Object.values(h.st.courtAssignments).map(c=>c.currentMatchId).filter(Boolean);
 assert.equal(current.length,1);assert.equal(new Set(current).size,1);
});
test('1→6→3→6 preserves current work, scores and bracket structure through existing shrink/drain behavior',()=>{
 const h=harness();resize(h,6);const current=new Set(Object.values(h.st.courtAssignments).map(c=>c.currentMatchId));
 h.st.matches.find(m=>m.id===h.st.courtAssignments.court6.currentMatchId).scoreB=2;
 const protectedRows=h.st.matches.filter(m=>current.has(m.id)).map(m=>[m.id,m.station,m.scoreA,m.scoreB,clone(m.log)]);
 const slots=structure(h.st);resize(h,3);assert.equal(h.api.target(h.st),3);assert.equal(h.st.meta.stations,6);
 resize(h,6);assert.equal(h.st.meta.stations,6);assert.deepEqual(structure(h.st),slots);
 assert.deepEqual(h.st.matches.filter(m=>current.has(m.id)).map(m=>[m.id,m.station,m.scoreA,m.scoreB,clone(m.log)]),protectedRows);
});
for(const [label,patch] of Object.entries({
 'zero-score in_progress':{status:'in_progress'},paused:{status:'paused'},started:{startedAt:99},
 score:{scoreA:1},log:{log:[{points:1}]},fault:{faultActions:[{side:'a'}]},
 confirmed:{confirmedAt:99},confirmedBy:{confirmedBy:'synthetic'},result:{resultMethod:'judgment'},
 offline:{offlinePendingSync:true},winner:{winnerId:'synthetic'},completed:{completed:true},
 PASS:{skippedAt:55,callPass:{waitFor:['r0m4']},skipWaitFor:['r0m4']},
 detached:{station:0,forceDetached:{from:1}},manualSkip:{skipManualOnly:true},resume:{resumeQueuedAt:77}
})){
 test('expansion and idle fill never move '+label,()=>{
  const h=harness(),m=h.st.matches[3];Object.assign(m,clone(patch));const saved=clone(m);
  assert(h.api.request(h.st,6,1,100,0).ok);assert.deepEqual(clone(m),saved);
  for(let n=2;n<=6;n++)assert(!h.ctx.idleCourtCandidates(h.st,n).some(x=>x.id===m.id));
 });
}
test('PASS predecessors and identity/dependency fields remain unchanged',()=>{
 const h=harness(),m=h.st.matches[3],dep=h.st.matches[4];
 m.skippedAt=55;m.callPass={waitFor:[dep.id],approvedAt:56};m.skipWaitFor=[dep.id];
 const before=clone([m,dep]);h.api.request(h.st,6,1,100,0);assert.deepEqual(clone([m,dep]),before);
});
test('6→1→3 expansion of a draining plan preserves high-court next through request and repeated reconcile',()=>{
 const h=harness();resize(h,6);resize(h,1);
 const high=h.st.courtAssignments.court6,current=h.st.matches.find(m=>m.id===high.currentMatchId);
 const next=h.st.matches.find(m=>m.station===1&&!m.completed&&m.id!==h.st.courtAssignments.court1.currentMatchId&&m.id!==h.st.courtAssignments.court1.nextMatchId);
 next.station=6;next.confirmedAt=123;high.nextMatchId=next.id;
 const saved=clone(next),currentStation=current.station;
 assert(h.api.request(h.st,3,1,100,h.st.courtRetirementPlan.revision).ok);
 assert.deepEqual(clone(next),saved);assert.equal(high.nextMatchId,next.id);
 for(let i=0;i<3;i++)h.api.reconcile(h.st,101+i);
 assert.deepEqual(clone(next),saved);assert.equal(current.station,currentStation);assert.equal(h.st.meta.stations,6);
 assert(h.st.courtRetirementPlan.expansionHeldIds.includes(next.id));
});
test('closed source/destination courts and detached station zero are excluded',()=>{
 const h=harness();h.st.forcedCourtExits[3]={closed:true};resize(h,6);
 assert(!h.st.matches.some(m=>m.station===3));assert(!h.st.courtAssignments.court3.currentMatchId);
 const m=h.st.matches[5];m.station=3;assert(!h.api.movableQueuedMatches(h.st).some(x=>x.id===m.id));
});
test('each idle claim is immediately reserved; five empty courts get five distinct unreserved matches',()=>{
 const h=harness();h.st.meta.stations=6;const oldNext=h.st.courtAssignments.court1.nextMatchId;
 h.ctx.rebuildPropagationForState(h.st);const cs=Object.values(h.st.courtAssignments);
 assert(cs.every(c=>c.currentMatchId));assert.equal(new Set(cs.map(c=>c.currentMatchId)).size,6);
 assert.equal(h.st.courtAssignments.court1.nextMatchId,oldNext);
 assert(h.st.matches.every(m=>Number(m.dispatchRevision||0)<=1));
});
test('valid old next survives lower-sequence arrivals, but stale/completed/blocked next is replaced',()=>{
 const h=harness();h.st.courtAssignments.court1.nextMatchId='r0m10';
 h.ctx.rebuildCourtAssignments();assert.equal(h.st.courtAssignments.court1.nextMatchId,'r0m10');
 h.st.matches[10].status='paused';h.ctx.rebuildCourtAssignments();assert.equal(h.st.courtAssignments.court1.nextMatchId,'r0m1');
 h.st.courtAssignments.court1.nextMatchId='missing';h.ctx.rebuildCourtAssignments();assert.equal(h.st.courtAssignments.court1.nextMatchId,'r0m1');
});
test('real winner propagation still fills correct later-round slots after expansion',()=>{
 const h=harness();resize(h,6);
 for(const id of ['r0m0','r0m1']){const m=h.st.matches.find(m=>m.id===id);m.completed=true;m.status='completed';m.winnerId=m.a.playerId;m.loserId=m.b.playerId;}
 h.ctx.rebuildPropagationForState(h.st);
 const m=h.st.matches.find(m=>m.id==='r1m0');assert.equal(m.a.playerId,'p0');assert.equal(m.b.playerId,'p2');
});
test('finished current advances the reserved next even when its seq is later',()=>{
 const h=harness();h.st.courtAssignments.court1.nextMatchId='r0m10';resize(h,6);
 const current=h.st.matches[0];current.completed=true;current.status='completed';current.winnerId=current.a.playerId;current.loserId=current.b.playerId;
 h.ctx.rebuildPropagationForState(h.st);assert.equal(h.st.courtAssignments.court1.currentMatchId,'r0m10');
});
test('explicit transfer/resume and eligible PASS priority still override an old next',()=>{
 for(const priority of [{dispatchPriorityAt:123},{skippedAt:120,resumeQueuedAt:123},{skippedAt:120,skipWaitFor:[],callPass:{waitFor:[]}}]){
  const h=harness(),manual=h.st.matches[3];Object.assign(manual,priority);
  h.ctx.rebuildCourtAssignments();assert.equal(h.st.courtAssignments.court1.nextMatchId,manual.id);
  h.st.matches[0].completed=true;h.ctx.rebuildCourtAssignments();assert.equal(h.st.courtAssignments.court1.currentMatchId,manual.id);
 }
});
test('bronze gate is unchanged across expansion, including blocked championship final',()=>{
 const h=harness(4);h.st.meta.bronzeMatch=true;
 for(const m of h.st.matches.filter(m=>m.round===0)){m.completed=true;m.status='completed';m.winnerId=m.a.playerId;m.loserId=m.b.playerId;}
 // A stable existing bronze node avoids only the random ID generator; all propagation is original.
 h.st.bronzeMatchId='bronze';h.st.matches.push({id:'bronze',bracket:'BZ',round:0,indexInRound:0,seq:1.5,station:1,status:'pending',a:null,b:null,scoreA:0,scoreB:0,log:[],completed:false});
 resize(h,6);const final=h.st.matches.find(m=>m.id==='r1m0');
 assert(h.ctx.singleElimBronzeBeforeFinalBlocked(final,h.st.matches,h.st.meta));
 assert(!Object.values(h.st.courtAssignments).some(c=>c.currentMatchId===final.id||c.nextMatchId===final.id));
});
test('stale plan revision rejects ABA count changes before mutating state',()=>{
 const h=harness();h.api.request(h.st,6,1,100,0);
 h.api.request(h.st,1,6,200,h.st.courtRetirementPlan.revision);
 const saved=clone(h.st),r=h.api.request(h.st,6,1,300,0);
 assert.equal(r.reason,'court-plan-stale');assert.deepEqual(clone(h.st),saved);
});
function cloudHarness(options={}){
 const h=harness(),doc={data:JSON.stringify(h.st),updatedAt:1,...options.doc},writes=[],reads=[];
 Object.assign(h.ctx,{cloudEnabled:true,dbHandle:{},authHandle:{currentUser:{uid:'admin'}},USERS_COLLECTION:'users',
  // Event-info formatting is unrelated to routing. All scheduling, fences and mirror projection are original.
  buildPublicEventInfo:()=>({}),fx:{
   doc:(_,collection,id)=>collection+'/'+id,
   runTransaction:async(_,fn)=>{
    const run=async()=>{const staged=[];const result=await fn({
     get:async ref=>{assert.equal(staged.length,0,'all reads precede writes');reads.push(ref);return{exists:()=>true,data:()=>ref.startsWith('users/')?{active:true,role:'admin'}:clone(doc)};},
     set:(...args)=>staged.push(args)
    });return{result,staged};};
    if(options.retry){await run();options.retry(doc);}
    const {result,staged}=await run();writes.push(...staged);return result;
   }}});
 for(const name of ['computeTournamentPhase','courtLifecycleWritePatch','advanceOnsiteWriteFence','buildPublicMirrorFields'])vm.runInContext(extract(cloud,name,'  '),h.ctx);
 const start=cloud.indexOf('    async courtRetirementTransaction('),end=cloud.indexOf('\n    async mutateMatchTransaction(',start);
 vm.runInContext('var cloudApi={'+cloud.slice(start,end)+'};',h.ctx);
 return {...h,doc,writes,reads,call:change=>h.ctx.cloudApi.courtRetirementTransaction('bxh-fixture',change,'admin')};
}
const change={kind:'resize',count:6,expectedTarget:1,expectedRevision:0};
test('original cloud transaction commits private + public together, with original lifecycle/QR/onsite fences',async()=>{
 const h=cloudHarness();const s=JSON.parse(h.doc.data);
 Object.assign(s,{courtLifecycleEpoch:1,qrCheckinManaged:true,qrCheckinRevision:3,onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:5});
 Object.assign(h.doc,{data:JSON.stringify(s),courtLifecycleEpoch:1,courtLifecycleWriteSeq:7,qrCheckinManaged:true,qrCheckinRevision:3,onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:5});
 const out=await h.call(change);assert(out.ok,out.reason);assert.equal(h.writes.length,2);
 assert.deepEqual(h.reads,['tournaments/BXH-FIXTURE','users/admin']);
 const priv=h.writes.find(x=>x[0].startsWith('tournaments/'))[1],pub=h.writes.find(x=>x[0].startsWith('publicTournaments/'))[1];
 assert.equal(priv.courtLifecycleWriteSeq,8);assert.equal(priv.qrCheckinRevision,4);assert.equal(priv.onsiteWaitlistRuntimeRevision,6);
 assert.equal(pub.qrCheckinRevision,4);assert.equal(pub.onsiteWaitlistRuntimeRevision,6);
 assert.deepEqual(JSON.parse(priv.data).courtAssignments&&Object.values(JSON.parse(priv.data).courtAssignments).map(c=>[c.currentMatchId,c.nextMatchId]),Object.values(JSON.parse(pub.bracketView).courtAssignments).map(c=>[c.currentMatchId,c.nextMatchId]));
 assert.equal(priv.updatedAt,pub.updatedAt);assert(!Object.hasOwn(pub,'data'));
});
test('cloud stale/missing revision rejects before writes; no call-service or courtCalls reads',async()=>{
 for(const payload of [{...change,expectedRevision:99},{...change,expectedRevision:undefined}]){
  const h=cloudHarness(),out=await h.call(payload);assert.equal(out.reason,'court-plan-stale');assert.equal(h.writes.length,0);
  assert(h.reads.every(x=>x.startsWith('users/')||x.startsWith('tournaments/')));
 }
});
test('transaction retry re-evaluates latest score/current rather than overwrite concurrent play',async()=>{
 const h=cloudHarness({retry:doc=>{
  const s=JSON.parse(doc.data),m=s.matches[3];m.scoreA=2;m.log=[{points:2}];m.status='in_progress';
  s.courtAssignments.court1.nextMatchId=m.id;doc.data=JSON.stringify(s);doc.updatedAt=999;
 }});
 const out=await h.call(change);assert(out.ok,out.reason);assert.equal(h.writes.length,2);
 const s=JSON.parse(h.writes[0][1].data),m=s.matches[3];assert.equal(m.station,1);assert.equal(m.scoreA,2);assert.deepEqual(m.log,[{points:2}]);assert.equal(m.dispatchRevision||0,0);
});
test('transaction retry rejects changed resize plan instead of committing stale first-attempt routing',async()=>{
 const h=cloudHarness({retry:doc=>{const s=JSON.parse(doc.data);s.courtRetirementPlan={targetCount:1,revision:7,status:'completed',courts:{}};doc.data=JSON.stringify(s);}});
 const out=await h.call(change);assert.equal(out.reason,'court-plan-stale');assert.equal(h.writes.length,0);
});
test('UI captures the plan revision before asynchronous pending-write flushes',async()=>{
 const h=harness();h.st.id='fixture';h.st.cloudCode='BXH-FIXTURE';let release;const sent=[];
 Object.assign(h.ctx,{courtRetirementBusy:false,cloudAvailable:()=>true,
  flushStationMatchMutations:()=>new Promise(resolve=>{release=resolve;}),flushCloudStateWrites:async()=>true,currentAuthUid:()=>'admin',
  resetSettingsFormDraft:()=>{},resetRegistrationFormDraft:()=>{},saveRecord:async()=>{},showToast:()=>{},renderPreservingScroll:()=>{}});
 h.ctx.window.cloudSync={courtRetirementTransaction:async(code,payload)=>{sent.push(clone(payload));return{ok:true};}};
 const start=core.indexOf('async function resizeCourtsSafely('),end=core.indexOf('\nasync function transferRetiringCourtMatch(',start);
 vm.runInContext(core.slice(start,end),h.ctx);
 const pending=h.ctx.resizeCourtsSafely(6,1,{stations:6});
 h.st.courtRetirementPlan={targetCount:1,revision:9,status:'completed',courts:{}};release(true);await pending;
 assert.equal(sent.length,1);assert.equal(sent[0].expectedRevision,0);assert.equal(h.ctx.courtRetirementBusy,false);
});
test('stale existing QR/onsite/lifecycle fences still reject before any staged writes',async()=>{
 for(const mode of ['qr','onsite','lifecycle']){
  const h=cloudHarness(),s=JSON.parse(h.doc.data);
  if(mode==='qr'){Object.assign(h.doc,{qrCheckinManaged:true,qrCheckinRevision:3});Object.assign(s,{qrCheckinManaged:true,qrCheckinRevision:2});}
  if(mode==='onsite'){Object.assign(h.doc,{onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:3});Object.assign(s,{onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:2});}
  if(mode==='lifecycle'){Object.assign(h.doc,{courtLifecycleEpoch:1,courtLifecycleWriteSeq:3});s.courtLifecycleEpoch=0;}
  h.doc.data=JSON.stringify(s);const out=await h.call(change);assert.equal(out.ok,false);assert.equal(h.writes.length,0);
 }
});
