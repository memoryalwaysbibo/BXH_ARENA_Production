'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const F=require('../referee-fault-core.js');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
const block=core.slice(core.indexOf('const refereeFaultWrites ='),core.indexOf('\nfunction undoLast('));
const permission=core.slice(core.indexOf('function requireStationPermission('),core.indexOf('\nfunction flattenedRefereeStationUids('));
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture({scoped=true}={}){
 const m={id:'quarter',station:1,status:'in_progress',scoreA:3,scoreB:3,completed:false,a:{playerId:'ken'},b:{playerId:'hsu'},log:[],faultActions:[]};
 const ctx={state:{id:'room',cloudCode:scoped?'ROOM':null,meta:{playMode:'standard'},matches:[m]},pendingModal:null,cloudStatus:'connected',console,
  canOperateCurrentTournament:()=>true,requireTournamentStartedForMatchAction:()=>true,canOperateMatchStation:()=>true,
  cloudAvailable:()=>true,currentAuthUid:()=> 'ref',getMatch:id=>ctx.state.matches.find(x=>x.id===id),
  checkWinnerSide:x=>x.scoreA>=4&&x.scoreA>x.scoreB?'A':x.scoreB>=4&&x.scoreB>x.scoreA?'B':null,
  refereeFaultApi:()=>F,playerName:id=>id,render:()=>{},shouldUseStationScopedMutation:()=>scoped};
 const messages=[],pending=[];ctx.showToast=(text,error)=>messages.push({text,error:!!error});
 ctx.persistRefereeMatchMutation=(id,callback)=>new Promise((resolve,reject)=>pending.push({callback,resolve,reject}));
 vm.createContext(ctx);vm.runInContext(block+'\n'+permission,ctx);
 function settle(ok=true,remote=clone(ctx.state)){
  const op=pending.shift();assert.ok(op,'one write queued');
  if(!scoped){op.resolve(ok);return;}
  if(!ok){op.resolve({ok:false,reason:'permission-denied'});return;}
  const result=op.callback(remote,remote.matches[0]);
  if(result.ok)ctx.state=result.state;
  op.resolve(result);return result;
 }
 return {ctx,m,messages,pending,settle};
}
test('first fault waits for acknowledgement; repeat clicks and same-match score actions are blocked',async()=>{
 const h=fixture(),p=h.ctx.addFault('quarter','B');
 assert.equal(h.m.faultActions.length,0);assert.equal(h.messages.some(x=>x.text.includes('已儲存')),false);
 assert.equal(h.ctx.requireStationPermission(h.m),false);
 await h.ctx.addFault('quarter','B');assert.equal(h.pending.length,1);
 h.settle();await p;assert.equal(h.ctx.state.matches[0].faultActions.length,1);assert.equal(h.ctx.requireStationPermission(h.ctx.state.matches[0]),true);
});
test('winning second fault creates confirmation only after acknowledged +1',async()=>{
 const h=fixture();F.applyFault(h.m,'B',100);const p=h.ctx.addFault('quarter','B');
 assert.equal(h.m.scoreA,3);assert.equal(h.ctx.pendingModal,null);
 h.settle();await p;assert.equal(h.ctx.state.matches[0].scoreA,4);assert.equal(h.ctx.state.matches[0].log[0].type,'fault');assert.equal(h.ctx.pendingModal.type,'confirm-result');
});
test('rejected second fault leaves 3:3 and first fault intact, with no stale winner dialog or success',async()=>{
 const h=fixture();F.applyFault(h.m,'B',100);const p=h.ctx.addFault('quarter','B');h.settle(false);await p;
 assert.equal(h.m.scoreA,3);assert.equal(h.m.faultActions.length,1);assert.equal(h.ctx.pendingModal,null);assert.equal(h.messages.some(x=>x.text.includes('已儲存')),false);
 assert.equal(h.ctx.refereeFaultWritePending(h.m),false);
});
test('another device advancing the round rejects delayed fault instead of counting in the new round',async()=>{
 const h=fixture();F.applyFault(h.m,'B',100);const remote=clone(h.ctx.state);remote.matches[0].faultActions=[];remote.matches[0].scoreB=2;
 const p=h.ctx.addFault('quarter','B');const result=h.settle(true,remote);await p;
 assert.equal(result.reason,'fault-state-stale');assert.equal(remote.matches[0].faultActions.length,0);assert.equal(remote.matches[0].scoreA,3);assert.equal(h.ctx.pendingModal,null);
});
test('transaction exception unlocks the match without a false winner',async()=>{
 const h=fixture();F.applyFault(h.m,'B',100);const p=h.ctx.addFault('quarter','B');h.pending.shift().reject(Error('network'));await p;
 assert.equal(h.ctx.refereeFaultWritePending(h.m),false);assert.equal(h.ctx.pendingModal,null);assert.equal(h.m.scoreA,3);
});
test('local save failure restores first-fault state',async()=>{
 const h=fixture({scoped:false});F.applyFault(h.m,'B',100);const p=h.ctx.addFault('quarter','B');assert.equal(h.m.scoreA,4);h.settle(false);await p;
 assert.equal(h.m.scoreA,3);assert.equal(h.m.faultActions.length,1);assert.equal(h.ctx.pendingModal,null);
});
test('late response cannot open a result dialog in another room',async()=>{
 const h=fixture();F.applyFault(h.m,'B',100);const p=h.ctx.addFault('quarter','B');const op=h.pending.shift();h.ctx.state={id:'other',cloudCode:'OTHER',matches:[]};op.resolve({ok:true});await p;
 assert.equal(h.ctx.pendingModal,null);assert.equal(h.messages.length,0);
});
