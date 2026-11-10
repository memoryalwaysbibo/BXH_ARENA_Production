'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('../modules/main-app/bracket-commit.js');

function fixture(kind='draw'){
 const storage=new Map(),calls=[];
 let active=true,applied=null,success=0,reads=0;
 const base={id:'room',meta:{formatType:'single',battleMode:'individual'},matches:[],registrationRosterRevision:1};
 const result={...base,drawnAt:10,bracketSize:2,bracketDraw:{id:'v2-draw',revision:1},matches:[{id:'match',a:{playerId:'a'},b:{playerId:'b'}}],...(kind==='start'?{startedAt:20}:{})};
 const ctx={key:'actor:room',code:'BXH-ROOM',roomId:'room',confirmationDelayMs:0,confirmationAttempts:3,
  storage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  current:()=>active,state:()=>kind==='draw'?base:{...base,bracketDraw:{id:'v2-draw'}},operationId:()=> 'fixed-operation-id',
  send:async(action,payload)=>{calls.push({action,payload:{...payload}});return {ok:true,drawId:'v2-draw',revision:1,...(kind==='start'?{startedAt:20}:{})};},
  read:async()=>{reads++;return {ok:true,data:result,publicData:{...result}};},
  apply:value=>{applied=value;},changed(){},success(){success++;}};
 return {ctx,calls,storage,result,make:()=>createServer(ctx),leave:()=>{active=false;},get applied(){return applied;},get success(){return success;},get reads(){return reads;}};
}

test('a transient private/public read failure confirms the original draw without resending',async()=>{
 const h=fixture(),read=h.ctx.read;let first=true;
 h.ctx.read=async()=>first?(first=false,{ok:false}):read();
 const c=h.make();assert.equal(await c.begin(),true);
 assert.equal(h.calls.length,1);assert.equal(h.reads,1);assert.equal(h.success,1);
 assert.equal(h.applied.bracketDraw.id,'v2-draw');assert.equal(h.storage.size,0);
});

test('a temporarily mismatched public pairing is rechecked before showing failure',async()=>{
 const h=fixture(),read=h.ctx.read;let first=true;
 h.ctx.read=async()=>first?(first=false,{ok:true,data:h.result,publicData:{...h.result,matches:[]}}):read();
 const c=h.make();assert.equal(await c.begin(),true);
 assert.equal(h.calls.length,1);assert.equal(h.success,1);
});

test('a lost callable acknowledgement replays the identical operation ID',async()=>{
 const h=fixture(),send=h.ctx.send;let first=true;
 h.ctx.send=async(...args)=>first?(first=false,h.calls.push({action:args[0],payload:{...args[1]}}),Promise.reject(Object.assign(Error('lost'),{code:'functions/deadline-exceeded'}))):send(...args);
 const c=h.make();assert.equal(await c.begin(),true);
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);
 assert.equal(h.success,1);assert.equal(h.storage.size,0);
});

test('start confirmation recovers one stale read without submitting a second start',async()=>{
 const h=fixture('start'),read=h.ctx.read;let first=true;
 h.ctx.read=async()=>first?(first=false,{ok:true,data:{...h.result,startedAt:undefined},publicData:{...h.result,startedAt:undefined}}):read();
 const c=h.make();assert.equal(await c.start(true),true);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.confirmEarlyStart,true);
 assert.equal(h.success,1);assert.equal(h.applied.startedAt,20);
});

test('persistent mismatched data remains pending and is never treated as success',async()=>{
 const h=fixture();h.ctx.read=async()=>({ok:true,data:h.result,publicData:{...h.result,matches:[]}});
 const c=h.make();assert.equal(await c.begin(),false);
 assert.equal(h.calls.length,1);assert.equal(h.success,0);assert.equal(h.applied,null);
 assert.equal(c.status().error,'confirmation-timeout');assert.equal(h.storage.size,1);
});

test('a permanent callable rejection does not automatically resend',async()=>{
 const h=fixture();h.ctx.send=async(action,payload)=>{h.calls.push({action,payload});throw Object.assign(Error('denied'),{code:'functions/permission-denied'});};
 const c=h.make();assert.equal(await c.begin(),false);
 assert.equal(h.calls.length,1);assert.equal(h.success,0);assert.equal(h.storage.size,1);
});

test('leaving the room during a retry never applies a late result',async()=>{
 const h=fixture();h.ctx.read=async()=>{h.leave();return {ok:false};};
 const c=h.make();assert.equal(await c.begin(),false);
 assert.equal(h.calls.length,1);assert.equal(h.success,0);assert.equal(h.applied,null);
});
