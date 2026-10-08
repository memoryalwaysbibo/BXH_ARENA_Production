'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const config={enabled:true,projectId:'bxh-hc-test',authDomain:'bxh-hc-test.firebaseapp.com',apiKey:'AIza'+'x'.repeat(35),appId:'1:123:web:abc123',appCheckSiteKey:'x'.repeat(32)};
const origin='https://bxh-hc-test-hc01.web.app';
const challenge={environment:'sandbox',challengeId:'c1',participants:['A'],revision:0};
async function fixture(fetcher){const {createCloudTransport}=await import('../hunter-clash/hc01/cloud/transport.mjs');const auth={currentUser:{uid:'A',getIdToken:async()=> 'signed-test-token'}};return{auth,run:createCloudTransport({config,origin,auth,getAppCheckToken:async()=>({token:'appcheck-test-token'}),fetcher})};}
test('cloud configuration rejects production, unrelated origin and incomplete setup',async()=>{
  const {validateConfig}=await import('../hunter-clash/hc01/cloud/config.mjs');assert.equal(validateConfig(config,origin).projectId,'bxh-hc-test');
  for(const bad of [{...config,enabled:false},{...config,projectId:'bxh-arena'},{...config,authDomain:'bxh-arena.firebaseapp.com'},{...config,appCheckSiteKey:''},{...config,apiKey:'placeholder'}])assert.throws(()=>validateConfig(bad,origin));
  for(const url of ['https://arena.bxh.com.tw','http://127.0.0.1:5198','https://bxh-hc-test-hc01.web.app.evil.invalid','https://bxh-hc-test.web.app'])assert.throws(()=>validateConfig(config,url));
});
test('cloud transport sends captured Auth and App Check only to fixed test endpoint',async()=>{
  const {run}=await fixture(async(url,options)=>{assert.equal(url,'https://asia-east1-bxh-hc-test.cloudfunctions.net/hc01Command');assert.equal(options.headers.Authorization,'Bearer signed-test-token');assert.equal(options.headers['X-Firebase-AppCheck'],'appcheck-test-token');assert.deepEqual(JSON.parse(options.body),{data:{operation:'getChallenge',input:{challengeId:'c1'}}});assert.equal(options.credentials,'omit');return{ok:true,status:200,json:async()=>({result:{challenge}})};});
  assert.deepEqual(await run('getChallenge',{challengeId:'c1'},{uid:'A'}),{challenge});
});
test('account change or abort while retrieving credentials never sends a command',async()=>{
  let sent=0;const f=await fixture(async()=>{sent++;});let finish;f.auth.currentUser.getIdToken=()=>new Promise(resolve=>{finish=resolve;});
  const pending=f.run('createChallenge',{requestId:'one'},{uid:'A'});f.auth.currentUser={uid:'B'};finish('old-token');await assert.rejects(pending,/session-unavailable/);assert.equal(sent,0);
  const g=await fixture(async()=>{sent++;});const controller=new AbortController();controller.abort();await assert.rejects(g.run('createChallenge',{}, {uid:'A',signal:controller.signal}),e=>e.name==='AbortError');assert.equal(sent,0);
});
test('known server rejection is definitive; internal, malformed and cross-environment responses retain pending',async()=>{
  for(const [body,status,definitive]of [[{error:{status:'RESOURCE_EXHAUSTED',details:{reason:'pairing-rate-limited'}}},429,true],[{error:{status:'ABORTED',details:{reason:'revision-conflict'}}},409,true],[{error:{status:'INTERNAL',details:{reason:'revision-conflict'}}},500,false],[{error:{status:'UNAUTHENTICATED'}},401,false],[{result:{challenge:{...challenge,environment:'production'}}},200,false],[{result:{challenge:{...challenge,participants:['B']}}},200,false]]){
    const {run}=await fixture(async()=>({ok:status===200,status,json:async()=>body}));await assert.rejects(run('createChallenge',{}, {uid:'A'}),e=>!!e.definitive===definitive);
  }
});
test('network loss does not clear controller original request',async()=>{
  const {createController}=await import('../hunter-clash/hc01/controller.mjs');let sent;const {run}=await fixture(async(url,options)=>{sent=JSON.parse(options.body);throw Error('network-lost');});
  const client=createController({transport:run,requestId:()=> 'fixed-original'});client.setSession('A');await assert.rejects(client.mutate('createChallenge',{}));assert.equal(client.state().pending.input.requestId,'fixed-original');assert.equal(sent.data.input.requestId,'fixed-original');
});
test('cloud bundle stays isolated, preserves rules and records source hashes without deploying',async()=>{
  const {buildBundle}=require('../hunter-clash/hc01/cloud/build-bundle.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hc01-bundle-test-')),output=path.join(dir,'hc01-cloud-test-candidate');
  try{const m=await buildBundle({output,sourceCommit:'a'.repeat(40)});assert.equal(m.clientConfigured,false);assert.equal(m.deploymentPerformed,false);assert.equal(m.sdkBundleBuilt,false);
    const cfg=JSON.parse(fs.readFileSync(path.join(output,'firebase.json')));assert.equal(cfg.hosting.site,'bxh-hc-test-hc01');assert.equal('firestore'in cfg,false);assert.equal(cfg.functions.codebase,'hc01-isolated-test');
    assert.equal(JSON.parse(fs.readFileSync(path.join(output,'public/cloud/client-config.json'))).enabled,false);
    assert.equal(fs.readFileSync(path.join(output,'functions/hc01/service.cjs'),'utf8'),fs.readFileSync(path.join(__dirname,'../hunter-clash/hc01/service.cjs'),'utf8'));
    for(const record of m.files)assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(output,record.path))).digest('hex'),record.sha256);
    await assert.rejects(buildBundle({output:path.join(dir,'hc01-cloud-test-bad'),sourceCommit:'a'.repeat(40),clientConfig:{...config,projectId:'bxh-arena'}}));
    await assert.rejects(buildBundle({output,sourceCommit:'a'.repeat(40)}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('deployment and runtime fail closed for production and emulator environments before SDK initialization',()=>{
  const {assertDeployment}=require('../hunter-clash/hc01/cloud/deploy-preflight.cjs');assert.equal(assertDeployment({GCLOUD_PROJECT:'bxh-hc-test'}),'bxh-hc-test');
  for(const env of [{},{GCLOUD_PROJECT:'bxh-arena'},{GCLOUD_PROJECT:'bxh-hc-test',GOOGLE_CLOUD_PROJECT:'bxh-arena'},{GCLOUD_PROJECT:'bxh-hc-test',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180'}])assert.throws(()=>assertDeployment(env));
  const result=spawnSync(process.execPath,['hunter-clash/hc01/cloud/server-entry.cjs'],{cwd:path.join(__dirname,'..'),env:{...process.env,GCLOUD_PROJECT:'bxh-arena',GOOGLE_CLOUD_PROJECT:'bxh-arena'},encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/cloud-test-project-mismatch/);assert.doesNotMatch(result.stderr,/Cannot find module/);
});

test('history response is restricted to the captured authenticated account',async()=>{
  const history={environment:'sandbox',uid:'A',total:1,wins:1,losses:0,matches:[]};
  const f=await fixture(async()=>({ok:true,status:200,json:async()=>({result:{history}})}));assert.deepEqual(await f.run('getMyHistory',{}, {uid:'A'}),{history});
  for(const invalid of [{...history,uid:'B'},{...history,environment:'production'},{...history,wins:2}]){
    const g=await fixture(async()=>({ok:true,status:200,json:async()=>({result:{history:invalid}})}));await assert.rejects(g.run('getMyHistory',{}, {uid:'A'}),/unknown-response/);
  }
});
