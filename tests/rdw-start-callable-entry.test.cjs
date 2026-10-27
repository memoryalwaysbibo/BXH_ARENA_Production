'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve('rdw-start/server-entry.cjs'),'utf8');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
function factory(){
 const exports={};const db={};
 const mocks={
  'firebase-functions/v2/https':{onCall:(_options,handler)=>handler,HttpsError},
  'firebase-admin/app':{getApps:()=>[{}],initializeApp:()=>({})},
  'firebase-admin/firestore':{getFirestore:()=>db},
  '../scripts/lib/rdw-wired-ranked-start.cjs':{createWiredRankedStart:options=>{assert.equal(options.enabled,false,'registered export must stay disabled');return async()=>({ok:false,code:'rdw-disabled'});}}
 };
 vm.runInNewContext(source,{module:{exports},exports,process:{env:{GCLOUD_PROJECT:'demo-rdw',FIRESTORE_EMULATOR_HOST:'localhost:8080',FIREBASE_AUTH_EMULATOR_HOST:'localhost:9099'}},require:name=>{if(!mocks[name])throw Error('unexpected '+name);return mocks[name];}});
 return exports.createHandler;
}
const req={auth:{uid:'server-actor'},app:{appId:'verified-app'},data:{eventCode:'BXH-ABC123',drawRevision:2,expectedRosterRevision:3}};
test('callable entry is disabled even for authenticated valid caller',async()=>{
 const handler=factory()();await assert.rejects(handler(req),e=>e.code==='failed-precondition'&&e.message==='rdw-start-disabled');
});
test('enabled entry only forwards minimal fields with Auth uid',async()=>{
 let call;
 const handler=factory()({enabled:true,start:async args=>{call=args;return {ok:true,mode:'rdw-verified'};}});
 const response=await handler(req);
 assert.equal(call.actorUid,'server-actor');assert.equal(call.eventCode,req.data.eventCode);
 assert.equal(call.drawRevision,2);assert.equal(call.expectedRosterRevision,3);
 assert.equal(response.ok,true);
});
test('spoofed caller tiers, UID and extra fields are rejected',async()=>{
 const handler=factory()({enabled:true,start:async()=>({ok:true})});
 for(const extra of [{actorUid:'fake'},{rosterUids:['fake']},{authorized:true},{verifiedTiers:[]},{timestamp:1}]){
  await assert.rejects(handler({...req,data:{...req.data,...extra}}),e=>e.code==='invalid-argument');
 }
});
test('auth, App Check, unconnected backend and failed start fail closed',async()=>{
 const handler=factory()({enabled:true,start:async()=>({ok:false})});
 await assert.rejects(handler({...req,auth:null}),e=>e.code==='unauthenticated');
 await assert.rejects(handler({...req,app:null}),e=>e.code==='failed-precondition');
 await assert.rejects(factory()({enabled:true})(req),e=>e.code==='unavailable');
 await assert.rejects(handler(req),e=>e.code==='failed-precondition');
});
