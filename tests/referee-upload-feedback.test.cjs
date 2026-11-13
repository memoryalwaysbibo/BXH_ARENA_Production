'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('modules/main-app/core.js','utf8');
const helpers=source.slice(source.indexOf('const refereeUploads='),source.indexOf('const refereeSeatCommandBusy='));
const bridge=source.slice(source.indexOf('const refereeSeatCommandBusy='),source.indexOf('\nasync function executeRefereeDispatchCommand('));
const permission=source.slice(source.indexOf('function requireStationPermission('),source.indexOf('\nfunction flattenedRefereeStationUids('));
function harness(){
 const timers=new Map(),pending=[],writes=[];let seq=0,renders=0;
 const matches=[1,2].map(n=>({id:'m'+n,station:n,a:{playerId:'a'},b:{playerId:'b'},scoreA:0,scoreB:0,log:[]}));
 const c={state:{id:'room',cloudCode:'BXH-TEST',startedAt:1,meta:{refereeSeatsV1:{version:1,courts:{}}},matches},cloudStatus:'connected',pendingModal:null,
  currentAuthUid:()=> 'judge',getMatch:id=>c.state.matches.find(m=>m.id===id),canUseRefereeSeatCommands:()=>true,canOperateMatchStation:()=>true,
  cloudAvailable:()=>true,refereeFaultWritePending:()=>false,showToast:()=>{},render:()=>renders++,applyRemoteState:st=>c.state=st,checkWinnerSide:()=>null,stationMutationErrorMessage:r=>r,
  navigator:{onLine:true},crypto:{randomUUID:()=> 'op-'+(++seq)},setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  window:{cloudSync:{commitRefereeCommand:r=>{writes.push(r);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},joinRoom:async()=>({ok:false})}}};
 vm.createContext(c);vm.runInContext(helpers+bridge+permission,c);
 return {c,pending,writes,timers,renders:()=>renders,tick(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
test('pending intent locks same court immediately, other court stays usable, slow timer never sends requests',async()=>{
 const h=harness(),{c}=h,p=c.executeRefereeSeatCommand('m1',{action:'score',side:'A',finish:'spin'});
 assert.match(c.refereeUploadStatusHtml(1),/分數上傳中/);assert.equal(c.requireStationPermission('m1'),false);assert.equal(c.requireStationPermission('m2'),true);
 await c.executeRefereeSeatCommand('m1',{action:'score',side:'A',finish:'spin'});assert.equal(h.writes.length,1);
 h.tick(8000);assert.match(c.refereeUploadStatusHtml(1),/正在等待確認/);assert(c.refereeUploadPending(c.getMatch('m1')));assert.equal(h.writes.length,1);
 h.pending.shift().resolve({ok:true,state:structuredClone(c.state)});assert.equal(await p,true);
 assert.match(c.refereeUploadStatusHtml(1),/✓ 分數已儲存/);assert(!c.refereeUploadPending(c.getMatch('m1')));
 h.tick(2500);assert.match(c.refereeUploadStatusHtml(1),/data-phase="idle"/);assert.equal(h.timers.size,0);
});
test('definite rejection never shows saved and permits a corrected operation',async()=>{
 const h=harness(),p=h.c.executeRefereeSeatCommand('m1',{action:'score'});h.pending.shift().resolve({ok:false,reason:'score-stale'});await p;
 assert.match(h.c.refereeUploadStatusHtml(1),/分數未儲存/);assert.equal(h.c.requireStationPermission('m1'),true);assert.equal(h.timers.size,0);
});
test('timeout and rejected transport remain unconfirmed instead of falsely claiming no write',async()=>{
 for(const throws of [false,true]){
  const h=harness(),p=h.c.executeRefereeSeatCommand('m1',{action:'score'}),op=h.pending.shift();
  throws?op.reject(Error('network')):op.resolve({ok:false,reason:'deadline-exceeded'});await p;
  assert.match(h.c.refereeUploadStatusHtml(1),/結果尚未確認/);assert(!h.c.refereeUploadStatusHtml(1).includes('已儲存'));assert.equal(h.writes.length,1);assert.equal(h.timers.size,0);
 }
});
test('late acknowledgement from another room/account does not render or show success there',async()=>{
 const h=harness(),p=h.c.executeRefereeSeatCommand('m1',{action:'undo'}),old=structuredClone(h.c.state);
 h.c.state={id:'other',cloudCode:'BXH-OTHER',matches:[]};const draws=h.renders();h.tick(8000);assert.equal(h.renders(),draws);
 h.pending.shift().resolve({ok:true,state:old});assert.equal(await p,false);assert.equal(h.c.state.id,'other');assert.match(h.c.refereeUploadStatusHtml(1),/data-phase="idle"/);assert.equal(h.renders(),draws);
});
test('earlier success timer cannot clear a new pending operation',async()=>{
 const h=harness(),p=h.c.executeRefereeSeatCommand('m1',{action:'score'});h.pending.shift().resolve({ok:true,state:structuredClone(h.c.state)});await p;
 const old=[...h.timers.values()][0].fn;
 const next=h.c.executeRefereeSeatCommand('m1',{action:'undo'});old();assert(h.c.refereeUploadPending(h.c.getMatch('m1')));assert.match(h.c.refereeUploadStatusHtml(1),/分數上傳中/);
 h.pending.shift().resolve({ok:false,reason:'score-stale'});await next;
});
module.exports={helpers,bridge,permission,harness};
test('legacy transaction shares pending feedback until acknowledgement and rejects same-court duplicates',async()=>{
 const h=harness(),{c}=h;c.state.meta={};
 Object.assign(c,{cloneStateForSave:structuredClone,saveRecord:async()=>true,shouldUseStationScopedMutation:()=>true,flushCloudStateWrites:async()=>true,cloudSyncPending:false,Date});
 c.window.cloudSync.mutateMatchTransaction=()=>new Promise(resolve=>h.pending.push({resolve}));
 const from=source.indexOf('async function persistRefereeMatchMutation('),to=source.indexOf('\nasync function flushStationMatchMutations(',from);
 vm.runInContext('let stationMutationChain=Promise.resolve({ok:true});'+source.slice(from,to),c);
 const p=c.persistRefereeMatchMutation('m1',()=>{});assert(c.refereeUploadPending(c.getMatch('m1')));
 assert.equal((await c.persistRefereeMatchMutation('m1',()=>{})).reason,'operation-pending');
 // Flush the original queue's microtasks without advancing a wall-clock timer.
 for(let i=0;i<8&&!h.pending.length;i++)await Promise.resolve();assert.equal(h.pending.length,1);
 h.tick(8000);assert.match(c.refereeUploadStatusHtml(1),/正在等待確認/);
 h.pending.shift().resolve({ok:true,state:structuredClone(c.state)});await p;assert.match(c.refereeUploadStatusHtml(1),/已儲存/);
});
