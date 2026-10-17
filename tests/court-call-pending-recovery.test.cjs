'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(require('node:path').join(__dirname,'..','court-call-ui.js'),'utf8');

function setup(){
 const saved=new Map(),calls=[],ctx={
  console,engagementSessionEpoch:1,currentAuthUid:()=> 'admin',
  sessionStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
  localStorage:{getItem:()=>null},crypto:{randomUUID:()=> 'new-operation'},
  confirm:()=>true,showToast:()=>{},renderPreservingScroll:()=>{},esc:String,
  window:{engagementService:{courtCall:async p=>{calls.push({...p});return {ok:true};}}}
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);
 vm.runInContext('syncCourtCallGlobalOverlay=()=>{};loadCourtCalls=async()=>{};',ctx);
 const c=ctx.courtCallContext('BXH-GJHTTW');
 const target={getAttribute:k=>({'data-code':'BXH-GJHTTW','data-match':'m1','data-sequence':'0'})[k]||null};
 return {ctx,c,calls,saved,target};
}

test('an uncertain request stays locked and retry preserves its operation ID',async()=>{
 const {ctx,c,calls,target}=setup();
 ctx.window.engagementService.courtCall=async p=>{calls.push({...p});throw Object.assign(Error('timeout'),{code:'functions/deadline-exceeded'});};
 await ctx.handleCourtCall('court-call-notify',target);
 assert.equal(c.pending.operationId,'new-operation');assert.equal(c.busy,false);
 ctx.window.engagementService.courtCall=async p=>{calls.push({...p});return {ok:true};};
 await ctx.handleCourtCall('court-call-retry',target);
 assert.equal(calls.length,2);assert.equal(calls[0].operationId,calls[1].operationId);
 assert.equal(c.pending,null);
});

test('explicit release unlocks this browser without sending a second notification',async()=>{
 const {ctx,c,calls,saved,target}=setup();
 c.pending={action:'notify',operationId:'old'};saved.set(c.storageKey,JSON.stringify(c.pending));
 await ctx.handleCourtCall('court-call-release-pending',target);
 assert.equal(c.pending,null);assert.equal(saved.has(c.storageKey),false);assert.equal(calls.length,0);
});

test('cancelled release and in-flight release preserve the pending operation',async()=>{
 const {ctx,c,target}=setup();c.pending={operationId:'old'};ctx.confirm=()=>false;
 await ctx.handleCourtCall('court-call-release-pending',target);assert.equal(c.pending.operationId,'old');
 c.busy=true;ctx.confirm=()=>{throw Error('must not offer release while sending');};
 await ctx.handleCourtCall('court-call-release-pending',target);assert.equal(c.pending.operationId,'old');
});

test('definitive rejection unlocks while unavailable/internal failures remain retryable',async()=>{
 for(const code of ['invalid-argument','not-found','unauthenticated','permission-denied','failed-precondition','out-of-range','unavailable','internal']){
  const {ctx,c,target}=setup();
  ctx.window.engagementService.courtCall=async()=>{throw Object.assign(Error(code),{code:'functions/'+code});};
  await ctx.handleCourtCall('court-call-notify',target);
  assert.equal(!!c.pending,['unavailable','internal'].includes(code),code);
 }
});

test('stored pending survives reload; releasing with unavailable storage still unlocks memory',async()=>{
 const {ctx,c,saved,target}=setup();
 saved.set(c.storageKey,JSON.stringify({action:'notify',operationId:'persisted'}));
 vm.runInContext('courtCallCache=new Map()',ctx);
 const restored=ctx.courtCallContext('BXH-GJHTTW');assert.equal(restored.pending.operationId,'persisted');
 ctx.sessionStorage.removeItem=()=>{throw Error('storage unavailable');};
 await ctx.handleCourtCall('court-call-release-pending',target);assert.equal(restored.pending,null);
});
