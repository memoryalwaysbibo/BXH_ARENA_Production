'use strict';
const {spawnSync}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const e=process.env;
const branch='lab/r2-home-websdk-reconnect-20261122';
if(e.GITHUB_ACTIONS!=='true'||e.GITHUB_EVENT_NAME!=='pull_request'||e.GITHUB_HEAD_REF!==branch||e.GITHUB_BASE_REF!=='main'||
 e.GCLOUD_PROJECT!=='demo-bxh-arena-e2e'||e.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
 e.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099')throw Error('r2-ci-exact-pr-and-original-emulator-only');
const innerEnv={...e};
for(const k of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIREBASE_CONFIG','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_EMULATOR_HUB'])delete innerEnv[k];
const attempt=require('node:crypto').randomUUID().slice(0,8);
console.log(JSON.stringify({test:'r2-wire',attempt,phase:'start'}));
// Separate working directory avoids two Firebase CLI processes sharing
// firestore-debug.log; continue using only the already installed dependencies.
const cwd=mkdtempSync(path.join(tmpdir(),'bxh-r2-emulator-'));
const q=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
let run;
try{
 const firebase=require.resolve('firebase-tools/lib/bin/firebase.js');
 const playwright=path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js');
 const command=[process.execPath,playwright,'test','--config='+path.join(__dirname,'playwright.config.cjs')].map(q).join(' ');
 run=spawnSync(process.execPath,[firebase,'emulators:exec','--only','firestore',
  '--project','demo-bxh-arena-r2-websdk','--config',path.join(__dirname,'firebase.json'),command],{
   stdio:'inherit',env:innerEnv,cwd,timeout:150000
  });
}finally{
 rmSync(cwd,{recursive:true,force:true});
}
const passed=run.status===0&&!run.error;
console.log(JSON.stringify({test:'r2-wire',attempt,phase:passed?'passed':'failed',exitStatus:run.status,
 error:run.error?.code??null}));
process.exitCode=passed?0:1;
