'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
test('deploy package exports only the read callable in an independent codebase',async()=>{
 const config=JSON.parse(fs.readFileSync(path.join(__dirname,'firebase.json')));
 assert.deepEqual(config.functions,[{source:'functions',codebase:'staff-roster',runtime:'nodejs22'}]);
 const options=[],exports={};
 const context={exports,require:name=>{
  if(name==='firebase-admin/app')return {initializeApp(){},getApps:()=>[{}]};
  if(name==='firebase-admin/firestore')return {getFirestore:()=>({runTransaction(){throw Error('unexpected transaction');}})};
  if(name==='firebase-functions/v2/https')return {onCall:(opts,fn)=>{options.push(opts);return fn;},HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}};
  if(name==='./service.cjs')return require('./functions/service.cjs');
  throw Error(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'functions/index.js'),'utf8'),context);
 assert.deepEqual(Object.keys(exports),['readStaffRegistrationRoster']);
 assert.equal(options[0].region,'asia-east1');
 await assert.rejects(()=>exports.readStaffRegistrationRoster({data:{code:'BXH-TEST'}}),e=>e.code==='unauthenticated');
 await assert.rejects(()=>exports.readStaffRegistrationRoster({auth:{uid:'u'},data:{code:'invalid'}}),e=>e.code==='invalid-argument');
});
