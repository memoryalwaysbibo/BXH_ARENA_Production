'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
const start=source.indexOf('    async queryMyRegistrations(options={})');
const end=source.indexOf('\n    // P3 Hunter Profile:',start);
test('personal registration scan shares requests, caps concurrency and reports incomplete reads',async()=>{
  let uid='a',clock=1000,queries=0,active=0,peak=0,fail=false,failOnce=false;
  const attempts=new Map(),docs=Array.from({length:18},(_,i)=>({id:'E'+i,data:()=>({eventDate:'2026-10-01',name:'Event '+i})}));
  class Clock extends Date {static now(){return clock;}}
  const context=vm.createContext({Date:Clock,Map,Promise,queueMicrotask,console,dbHandle:{},authReady:true,
    authHandle:{get currentUser(){return {uid};}},personalScan:null,personalPublicDocs:new Map(),
    fx:{collection:()=>({}),where:()=>({}),query:()=>({}),doc:(...args)=>args,
      getDocs:async()=>{queries++;return {forEach:fn=>docs.forEach(fn)};},
      getDoc:async args=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;
        const key=uid+':'+args[2],attempt=attempts.get(key)||0;attempts.set(key,attempt+1);
        if(fail||(failOnce&&attempt===0&&args[2]==='E17'))throw Object.assign(new Error('offline'),{code:'unavailable'});
        return {exists:()=>args[2]==='E17',data:()=>({uid:args[4]})};}}});
  vm.runInContext('globalThis.api={'+source.slice(start,end)+'};',context);
  const progress=[],first=context.api.queryMyRegistrations({onProgress:p=>progress.push(p)});
  clock+=31000;
  const result=await Promise.all([first,context.api.queryMyRegistrations()]);
  assert.equal(queries,1);assert.ok(peak<=4);assert.equal(result[0][0].uid,'a');
  assert.ok(progress.some(p=>p.registrations.length===1));
  uid='b';assert.equal((await context.api.queryMyRegistrations())[0].uid,'b');assert.equal(queries,2);
  uid='c';fail=true;const failures=[];
  const partial=await context.api.queryMyRegistrations({onReadFailure:(code,reason)=>failures.push([code,reason])});
  assert.equal(partial.partial,true);assert.equal(partial.length,0);assert.equal(partial.failedReads.length,18);
  assert.equal(partial.failedReads[0].eventName,'Event 0');assert.equal(failures.length,18);
  fail=false;assert.equal((await context.api.queryMyRegistrations({force:true})).partial,undefined);
  uid='d';failOnce=true;const recovered=await context.api.queryMyRegistrations();
  assert.equal(recovered.partial,undefined);assert.equal(recovered.length,1);assert.equal(attempts.get('d:E17'),2);
});
