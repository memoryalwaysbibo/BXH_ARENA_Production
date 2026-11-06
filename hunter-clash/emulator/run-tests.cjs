'use strict';
const {spawnSync}=require('node:child_process');
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
// Disable metadata credential discovery before Firebase CLI starts, not only inside handlers.
const child=spawnSync(process.execPath,[require.resolve('firebase-tools/lib/bin/firebase.js'),
  'emulators:exec','--project',PROJECT,'--only','firestore,auth,functions','--config','firebase.json',
  'node --test --test-concurrency=1 rules.test.cjs service.test.cjs callable.test.cjs browser.test.cjs lab.test.cjs'],{
  cwd:__dirname,stdio:'inherit',env:{...process.env,METADATA_SERVER_DETECTION:'none'}});
if(child.error)throw child.error;
process.exit(child.status ?? 1);
