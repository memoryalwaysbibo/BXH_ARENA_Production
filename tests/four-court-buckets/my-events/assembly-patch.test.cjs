'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {patchAssembly}=require('../../../release/buckets/my-events/patch-assembly.cjs');
const source=readFileSync(path.join(__dirname,'deployed-assembly.cjs'),'utf8');
test('exact assembly source refuses drift',()=>{
 assert.throws(()=>patchAssembly(source+'\n'),/assembly-source-drift/);
 assert.doesNotThrow(()=>new vm.Script(patchAssembly(source)));
});
test('read-only assembly passes the verified resolver to independent list and detail factories',()=>{
 const resolver=async()=>({status:'supported',active:true}),seen={};
 const module={exports:{}};
 const req=id=>{
  if(id==='./vendor/backend/service.cjs')return {createService:()=>({}),createAdminBridge:()=>({run(){},doc(){}})};
  if(id==='./vendor/backend/bucket-lifecycle.cjs')return {readRoomLifecycle:resolver};
  if(id==='./vendor/reader/auth-reader.cjs')return {createAuthenticatedReader:opts=>{seen.list=opts;return ()=>({})}};
  if(id==='./vendor/details/detail-reader.cjs')return {createDetailReader:opts=>{seen.detail=opts;return ()=>({})}};
  if(id==='./vendor/reader/operation-status.cjs')return {createOperationStatusReader:()=>()=>({})};
  throw Error('unexpected-module: '+id);
 };
 vm.runInNewContext(patchAssembly(source),{module,exports:module.exports,require:req},{filename:'candidate-assembly.cjs'});
 const out=module.exports.assemble({flags:{reads:true},db:{},documentId:'__name__',sdk:{onCall:(_options,handler)=>handler,onDocumentWritten(){},onSchedule(){}}});
 assert.equal(typeof out.queryMyActiveEvents,'function');
 assert.equal(typeof out.queryMyActiveEventDetails,'function');
 assert.equal(seen.list.resolveRoomLifecycle,resolver);
 assert.equal(seen.detail.resolveRoomLifecycle,resolver);
});
