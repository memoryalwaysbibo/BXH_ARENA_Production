'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertIsolated, PROJECT } = require('../hunter-clash/emulator/preflight.cjs');
test('emulator guard rejects production projects, credentials and remote hosts', () => {
  assert.equal(assertIsolated({}), PROJECT);
  assert.equal(assertIsolated({ GCLOUD_PROJECT: PROJECT, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8180' }), PROJECT);
  for (const env of [{GCLOUD_PROJECT:'bxh-arena'}, {GOOGLE_CLOUD_PROJECT:'bxh-arena-beta'},
    {FIREBASE_PROJECT_ID:'bxh-arena'}, {GOOGLE_APPLICATION_CREDENTIALS:'credential.json'},
    {FIREBASE_TOKEN:'test'}, {FIRESTORE_EMULATOR_HOST:'example.com:8180'},
    {FIREBASE_AUTH_EMULATOR_HOST:'example.com:9098'}])
    assert.throws(() => assertIsolated(env));
});

const {spawnSync}=require('node:child_process');
const path=require('node:path');
test('sandbox Functions bootstrap refuses non-emulator and production environments',()=>{
  const file=path.resolve(__dirname,'../hunter-clash/emulator/functions.cjs');
  for(const env of [{GCLOUD_PROJECT:PROJECT},{GCLOUD_PROJECT:'bxh-arena',FUNCTIONS_EMULATOR:'true'}]){
    const result=spawnSync(process.execPath,[file],{env,encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/sandbox-functions-only|unsafe-emulator-project/);
  }
});
test('Firebase predeploy hook unconditionally refuses publishing sandbox Functions',()=>{
  const config=require('../hunter-clash/emulator/firebase.json');
  assert.deepEqual(config.functions.predeploy,['node "$RESOURCE_DIR/preflight.cjs" --deny-deploy']);
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../hunter-clash/emulator/preflight.cjs'),'--deny-deploy'],{env:{},encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/sandbox-functions-cannot-deploy/);
});
const {assertSessionTarget}=require('../hunter-clash/emulator/seed-session.cjs');
test('manual lab refuses production, credentials and absent emulator connections',()=>{
  const db={projectId:PROJECT},auth={app:{options:{projectId:PROJECT}}};
  const env={FIRESTORE_EMULATOR_HOST:'127.0.0.1:8180',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9098'};
  assert.doesNotThrow(()=>assertSessionTarget(db,auth,env));
  for(const patch of [{GCLOUD_PROJECT:'bxh-arena'},{GOOGLE_APPLICATION_CREDENTIALS:'credential.json'},
    {FIRESTORE_EMULATOR_HOST:undefined},{FIREBASE_AUTH_EMULATOR_HOST:'remote:9098'}])
    assert.throws(()=>assertSessionTarget(db,auth,{...env,...patch}));
  assert.throws(()=>assertSessionTarget({projectId:'bxh-arena'},auth,env));
});
