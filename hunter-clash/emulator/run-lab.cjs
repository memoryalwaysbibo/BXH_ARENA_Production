'use strict';
const {spawnSync}=require('node:child_process');
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
// No export/import flags: all demo state is discarded when emulators stop.
const child=spawnSync(process.execPath,[require.resolve('firebase-tools/lib/bin/firebase.js'),
  'emulators:exec','--project',PROJECT,'--only','firestore,auth,functions','--config','firebase.json',
  'node manual-session.cjs'],{cwd:__dirname,stdio:'inherit',env:{...process.env,METADATA_SERVER_DETECTION:'none'}});
if(child.error)throw child.error;
process.exit(child.status??1);
