'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {memory}=require('./helpers/hc01-memory.cjs');const{createSetupService}=require('../hunter-clash/hc01/cloud/setup-service.cjs');
const env={GCLOUD_PROJECT:'demo-hunter-clash',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098'};
const input={uids:['A','B'],rules:{version:'hc01-internal-test-v1',targetScore:4},pairingTtlMs:120000};
function fixture(){const{db,data}=memory();const disabled=new Set();const auth={app:{options:{projectId:'demo-hunter-clash'}},async getUser(uid){return{uid,disabled:disabled.has(uid)};}};return{db,data,disabled,service:createSetupService({db,auth},env)};}
test('setup inspect is read-only and provisioning creates only closed HC01 configuration',async()=>{
  const f=fixture();const p=await f.service.inspect(input);assert.equal(f.data.size,0);assert.equal(p.hc01Enabled,false);assert.equal(p.applied,false);
  const r=await f.service.provisionClosed(input,p.planHash);assert.equal(r.applied,true);assert.equal(f.data.get('hcConfig/runtime').enabled,false);assert.equal(f.data.get('hcConfig/runtime').hc01Enabled,false);
  assert.deepEqual(f.data.get('hcActors/A'),{active:true,role:'player',hc01Allowed:true});assert.equal(f.data.size,3);
});
test('setup preserves existing HC00 settings, actor roles and all unrelated fields',async()=>{
  const f=fixture();f.data.set('hcConfig/runtime',{enabled:true,environment:'sandbox',hc00Policy:{keep:1},notes:'preserve'});f.data.set('hcActors/A',{active:true,role:'admin',label:'preserve',hc00Allowed:true});
  const p=await f.service.inspect(input);await f.service.provisionClosed(input,p.planHash);assert.equal(f.data.get('hcActors/A').role,'admin');assert.equal(f.data.get('hcActors/A').hc00Allowed,true);assert.equal(f.data.get('hcConfig/runtime').enabled,true);assert.deepEqual(f.data.get('hcConfig/runtime').hc00Policy,{keep:1});assert.equal(f.data.get('hcConfig/runtime').hc01Enabled,false);
});
test('changed database plan prevents any provisioning writes',async()=>{
  const f=fixture(),p=await f.service.inspect(input);f.data.set('hcActors/A',{active:true,role:'staff'});await assert.rejects(f.service.provisionClosed(input,p.planHash),/setup-plan-changed/);assert.equal(f.data.size,1);
});
test('disabled Auth, unavailable existing actor or unsafe config cannot be provisioned',async()=>{
  const f=fixture();f.disabled.add('A');await assert.rejects(f.service.inspect(input),/test-auth-account-unavailable/);f.disabled.clear();
  for(const actor of [{active:false,role:'player'},{active:true,role:'player',accountStatus:'frozen'},{active:true,role:'unknown'}]){f.data.set('hcActors/A',actor);await assert.rejects(f.service.inspect(input),/existing-actor-unavailable/);}
  f.data.clear();f.data.set('hcConfig/runtime',{environment:'production'});await assert.rejects(f.service.inspect(input),/unsafe-runtime-config/);assert.equal(f.data.size,1);
});
test('setup rejects duplicate accounts, excessive TTL and unsupported input',async()=>{
  const f=fixture();for(const bad of [{...input,uids:['A','A']},{...input,uids:['A']},{...input,pairingTtlMs:300001},{...input,role:'super_admin'}])await assert.rejects(f.service.inspect(bad));assert.equal(f.data.size,0);
});
test('candidate checker reports missing SDK/config and detects source modification',async()=>{
  const{buildBundle}=require('../hunter-clash/hc01/cloud/build-bundle.cjs'),{checkCandidate}=require('../hunter-clash/hc01/cloud/check-candidate.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hc01-setup-test-')),output=path.join(dir,'hc01-cloud-test-candidate');
  try{await buildBundle({output,sourceCommit:'a'.repeat(40)});let result=await checkCandidate(output);assert.equal(result.cloudVerified,false);assert.ok(result.blocked.includes('sdk-built'));assert.ok(result.blocked.includes('web-app-and-app-check-config'));assert.equal(result.blocked.includes('source-integrity'),false);
    fs.appendFileSync(path.join(output,'functions/hc01/service.cjs'),'\n// changed\n');result=await checkCandidate(output);assert.ok(result.blocked.includes('source-integrity'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('equivalent Firestore fields in a different order keep the same reviewed plan',async()=>{
  const f=fixture();f.data.set('hcActors/A',{active:true,role:'staff',hc00Allowed:true});const p=await f.service.inspect(input);
  f.data.set('hcActors/A',{hc00Allowed:true,role:'staff',active:true});await f.service.provisionClosed(input,p.planHash);assert.equal(f.data.get('hcActors/A').role,'staff');
});
