'use strict';
const {spawnSync}=require('node:child_process');
const {assertIsolated,PROJECT}=require('../../emulator/preflight.cjs');
assertIsolated(process.env);
const child=spawnSync(process.execPath,[require.resolve('firebase-tools/lib/bin/firebase.js'),
  'emulators:exec','--project',PROJECT,'--only','auth,firestore,functions','--config','firebase.json',
  'node --test --test-concurrency=1 integration.test.cjs'],{
  cwd:__dirname,stdio:'inherit',env:{...process.env,METADATA_SERVER_DETECTION:'none'}});
if(child.error)throw child.error;
process.exit(child.status??1);
