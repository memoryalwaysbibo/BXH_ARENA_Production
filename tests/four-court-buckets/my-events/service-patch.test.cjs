'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {patchService}=require('../../../release/buckets/my-events/patch-service.cjs');
const source=readFileSync(path.join(__dirname,'deployed-service.cjs'),'utf8');
function candidate(){
 const module={exports:{}};
 vm.runInNewContext(patchService(source),{module,exports:module.exports,require:()=>{throw Error('unexpected-module-load')}},{filename:'candidate-service.cjs'});
 return module.exports;
}
test('exact deployed service patch refuses source drift',()=>{
 assert.throws(()=>patchService(source+'\n'),/service-source-drift/);
 assert.match(patchService(source),/require\('\.\/bucket-lifecycle\.cjs'\)/);
});
test('enabled service passes one resolver to engine, rebuild, bootstrap and list reader',()=>{
 const seen={};
 const resolver=async()=>({status:'supported',active:true});
 const make=name=>opts=>{seen[name]=opts;return name==='engine'?{ingestRegistration(){},recordRoom(){},processPage(){},repair(){}}:name==='rebuilder'?{processPage(){},repair(){}}:name==='bootstrap'?{captureRoom(){},processPage(){},repair(){}}:name==='processor'?{processOperation(){},repair(){}}:()=>({})};
 const factories={resolveRoomLifecycle:resolver,createEngine:make('engine'),rebuild:{createRebuilder:make('rebuilder'),shouldProcessRebuild:()=>false},bootstrap:{createBootstrap:make('bootstrap'),shouldProcessBootstrap:()=>false},createOperationProcessor:make('processor'),createAuthenticatedReader:make('reader'),status:{createOperationStatusReader:()=>()=>({}),createAuthenticatedOperationRetry:()=>()=>({})}};
 const service=candidate().createService({db:{runTransaction(){}},documentId:'__name__',onCall:(_opts,fn)=>fn,onDocumentWritten:(_opts,fn)=>fn,onSchedule:(_opts,fn)=>fn,enabled:true,factories});
 assert.equal(typeof service.queryMyActiveEvents,'function');
 for(const name of ['engine','rebuilder','bootstrap','reader'])assert.equal(seen[name].resolveRoomLifecycle,resolver,name);
});
