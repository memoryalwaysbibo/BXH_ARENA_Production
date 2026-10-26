'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('rdw-start/diagnostic-entry.cjs','utf8');
function load(){const exports={},module={exports};const HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};
 const ctx={exports,module,require:name=>{if(name==='firebase-functions/v2/https')return {HttpsError,onCall:(opts,fn)=>{assert.equal(opts.enforceAppCheck,true);assert.equal(opts.region,'asia-east1');return fn;}};throw Error('unexpected-import:'+name);}};
 vm.runInNewContext(source,ctx);
 return {fn:exports.rdwDiagnosticService,make:module.exports.createDiagnosticHandler};
}
const request={auth:{uid:'actor'},app:{appId:'verified-app'},data:{eventCode:'BXH-ABC123'}};
test('registered diagnostic fails closed without privileged service',async()=>{
 const {fn,make}=load();
 await assert.rejects(fn(request),e=>e.code==='failed-precondition'&&e.message==='rdw-diagnostic-disabled');
 await assert.rejects(make({enabled:true})(request),e=>e.code==='unavailable');
});
test('authentication, App Check and data shape are enforced',async()=>{
 const {make}=load(),diagnose=async()=>({ok:true,eventCode:'BXH-ABC123'});
 const fn=make({enabled:true,diagnose});
 await assert.rejects(fn({...request,auth:null}),e=>e.code==='unauthenticated');
 await assert.rejects(fn({...request,app:null}),e=>e.code==='failed-precondition');
 for(const data of [{eventCode:'BXH-ABC123',authorized:true},{eventCode:'BXH-ABC123',tiers:['national']},{eventCode:'wrong'},null])
  await assert.rejects(fn({...request,data}),e=>e.code==='invalid-argument');
});
test('callable ignores unsanctioned provider fields and returns no private UID',async()=>{
 const {make}=load();let args;
 const fn=make({enabled:true,diagnose:async input=>{args=input;return {ok:true,eventCode:'BXH-ABC123',started:false,rosterSize:8,rosterRevision:4,verifiedAccounts:2,unverifiedAccounts:0,virtualPlayers:6,fullSnapshotEligible:false,policy:'ungraded-neutral-protected',formulaBands:[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}],internalUid:'not-for-output'};}});
 const response=await fn(request);
 assert.equal(args.actorUid,'actor');assert.equal(args.eventCode,'BXH-ABC123');
 assert.equal(response.virtualPlayers,6);assert.equal(response.fullSnapshotEligible,false);
 assert.equal(JSON.stringify(response).includes('not-for-output'),false);
 assert.equal(JSON.stringify(response).includes('actor'),false);
});
test('unauthorized server response maps to permission-denied',async()=>{
 const {make}=load();const fn=make({enabled:true,diagnose:async()=>({ok:false,reason:'not-authorized'})});
 await assert.rejects(fn(request),e=>e.code==='permission-denied');
});
