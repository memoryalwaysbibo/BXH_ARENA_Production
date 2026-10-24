const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('rdw-start/server-entry.cjs','utf8');
function load(){const exports={},module={exports};const HttpsError=class extends Error{constructor(code,message){super(message);this.code=code;}};const mocks={
 'firebase-functions/v2/https':{onCall:(opts,fn)=>{assert.equal(opts.region,'asia-east1');assert.equal(opts.enforceAppCheck,true);return fn;},HttpsError},
 'firebase-admin/app':{getApps:()=>[],initializeApp:()=>({})},
 'firebase-admin/firestore':{getFirestore:()=>({})}};
 const ctx={exports,module,process:{env:{GCLOUD_PROJECT:'demo-rdw',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'}},require:name=>{if(!(name in mocks))throw Error(name);return mocks[name];}};
 vm.runInNewContext(source,ctx);return {fn:exports.rdwStartService,createHandler:module.exports.createHandler};}
test('callable is registered but never performs writes',async()=>{const {fn}=load();await assert.rejects(fn({auth:{uid:'test'},data:{eventCode:'BXH-SDSAQZ'}}),e=>e.code==='failed-precondition'&&e.message==='rdw-start-disabled');});
test('missing auth rejected before feature gate',async()=>{const {fn}=load();await assert.rejects(fn({data:{}}),e=>e.code==='unauthenticated');});
test('even explicitly enabled placeholder remains unimplemented',async()=>{const {createHandler}=load();await assert.rejects(createHandler({enabled:true})({auth:{uid:'test'},data:{}}),e=>e.code==='unimplemented');});
