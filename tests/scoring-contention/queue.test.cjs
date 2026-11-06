'use strict';
// Diagnostic tests: reproduce historical gate behavior, not a runtime fix.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const root=process.env.BXH_LAB_SOURCE_ROOT;assert(root&&path.isAbsolute(root));
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
function extract(name){const a=core.search(new RegExp('^(?:async )?function '+name+'\\(','m')),b=core.indexOf('\n}',a);assert(a>=0&&b>a,name);return core.slice(a,b+2);}
function harness({priorWrite=true,pending=false}={}){
 const messages=[],calls={push:0,score:0,confirm:0,join:0};
 const match={id:'m1',station:1,scoreA:4,scoreB:0,completed:false,a:{playerId:'a'},b:{playerId:'b'},dispatchRevision:0,log:Array.from({length:4},(_,i)=>({v:1,eventId:'round'+i,seq:i+1,side:'A',type:'spin',points:1,t:i+1}))};
 const initial={id:'room',cloudCode:'BXH-LABQUEUE',meta:{stations:1,eventAuthority:'official'},players:[],matches:[match]};
 let remote=copy(initial);
 const c={state:copy(initial),cloudWriteChain:Promise.resolve(priorWrite),stationMutationChain:Promise.resolve({ok:true}),cloudSyncPending:pending,cloudStatus:'connected',pendingModal:null,adminDisplayName:'Lab',userProfile:{role:'staff',email:'lab@example.invalid'},
  POINT_TYPES:{spin:1,knockout:2,burst:2,extreme:3,fault:1},HUNTER_ROUND_SCHEMA_VERSION:1,HUNTER_SCORING_VERSION:'bxh-4pt-v1',HUNTER_VALID_POINT_TYPES:new Set(['spin','knockout','burst','extreme','fault']),
  navigator:{onLine:true},cloudAvailable:()=>true,currentAuthUid:()=> 'lab-ref1',canOperateCurrentTournament:()=>true,requireTournamentStartedForMatchAction:()=>true,requireStationPermission:()=>true,shouldUseStationScopedMutation:()=>true,
  cloneStateForSave:copy,saveRecord:async()=>true,getMatch:id=>c.state.matches.find(m=>m.id===id),showToast:m=>messages.push(m),render:()=>{},applyRemoteState:s=>{c.state=copy(s);},stationMutationErrorMessage:r=>r,
  rebuildPropagationForState:()=>{},rebuildPropagation:()=>{},defaultState:()=>({}),refereeMatches:()=>c.state.matches,isTournamentFullyDecided:()=>false,refereeStageLabel:()=> 'lab',playerName:id=>id,
  currentRefereeIdentity:()=>({uid:'lab-ref1',name:'Lab',isStaff:true}),completionFailureMessage:r=>r,
  window:{cloudSync:{
   pushUpdate:async()=>{calls.push++;return true;},
   joinRoom:async()=>{calls.join++;return {ok:true,data:copy(remote)};},
   mutateMatchTransaction:async(code,id,station,fn)=>{calls.score++;const s=copy(remote),r=fn(s,s.matches.find(m=>m.id===id));if(r.ok)remote=copy(r.state);return r;},
   confirmMatchTransaction:async(code,fn)=>{calls.confirm++;const r=fn(copy(remote));if(r.ok)remote=copy(r.state);return r;}
  }}};
 vm.createContext(c);
 const names=['enqueueCloudStateWrite','flushCloudStateWrites','persistRefereeMatchMutation','flushStationMatchMutations','confirmResultWithCloudGuard','evaluateMatchCompletion','normalizeHunterRoundEvent','validateHunterRoundLedger','checkWinnerSide','applyMatchCompletionFields'];
 vm.runInContext(names.map(extract).join('\n'),c);
 return {c,calls,messages,remote:()=>copy(remote)};
}
test('healthy confirmation reaches transaction and completes the valid 4:0 match',async()=>{const h=harness();assert.equal(await h.c.confirmResultWithCloudGuard('m1'),true);assert.equal(h.calls.confirm,1);assert.equal(h.remote().matches[0].completed,true);});
test('an old failed whole-state write blocks repeated confirmation before cloud transaction',async()=>{
 const h=harness({priorWrite:false});
 for(let i=0;i<3;i++)assert.equal(await h.c.confirmResultWithCloudGuard('m1'),false);
 assert.equal(h.calls.confirm,0);assert.equal(h.calls.push,0);assert.equal(h.remote().matches[0].completed,false);
 assert(h.messages.every(x=>x.includes('雲端賽事資料尚未同步完成')));
 console.log('QUEUE_DIAGNOSTIC historical-false => 3 confirmations blocked, 0 cloud confirmation requests');
});
test('successful score transaction does not clear the historical whole-state failure',async()=>{
 const h=harness({priorWrite:false});
 assert.equal((await h.c.persistRefereeMatchMutation('m1',s=>({ok:true,state:s}))).ok,true);
 assert.equal(h.calls.score,1);assert.equal(h.c.cloudStatus,'connected');
 assert.equal(await h.c.confirmResultWithCloudGuard('m1'),false);assert.equal(h.calls.confirm,0);
 console.log('QUEUE_DIAGNOSTIC current transaction succeeds / connected, yet confirmation gate stays false');
});
test('fresh room read does not clear historical whole-state failure',async()=>{
 const h=harness({priorWrite:false});const fresh=await h.c.window.cloudSync.joinRoom('BXH-LABQUEUE');h.c.applyRemoteState(fresh.data,true);
 assert.equal(await h.c.confirmResultWithCloudGuard('m1'),false);assert.equal(h.calls.confirm,0);assert.equal(h.calls.join,1);
});
test('pending retry plus historical failure blocks score before transaction even after a fresh read',async()=>{
 const h=harness({priorWrite:false,pending:true});
 const fn=s=>({ok:true,state:s});assert.equal((await h.c.persistRefereeMatchMutation('m1',fn)).ok,false);
 await new Promise(r=>setImmediate(r));assert.equal(h.calls.join,1);
 assert.equal((await h.c.persistRefereeMatchMutation('m1',fn)).ok,false);assert.equal(h.calls.score,0);
});
test('a new successful whole-state write replaces the failed promise and allows confirmation',async()=>{
 const h=harness({priorWrite:false});assert.equal(await h.c.confirmResultWithCloudGuard('m1'),false);
 assert.equal(await h.c.enqueueCloudStateWrite('BXH-LABQUEUE',copy(h.c.state)),true);
 assert.equal(await h.c.confirmResultWithCloudGuard('m1'),true);assert.equal(h.calls.push,1);assert.equal(h.calls.confirm,1);
});
test('a genuinely pending whole-state write holds later score without a bounded wait',async()=>{
 const h=harness();let release;h.c.cloudWriteChain=new Promise(r=>release=r);let settled=false;
 const task=h.c.persistRefereeMatchMutation('m1',s=>({ok:true,state:s})).then(r=>{settled=true;return r;});
 await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(h.calls.score,0);
 release(true);assert.equal((await task).ok,true);assert.equal(h.calls.score,1);
});
