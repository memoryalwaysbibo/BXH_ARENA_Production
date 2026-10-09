'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const ps1=fs.readFileSync(path.join(__dirname,'run-data01b-windows.ps1'),'utf8');
test('Windows local runner pins branch, original SHA and demo project',()=>{
 assert.match(ps1,/test\/bey-catalog-data01b-private-emulator-20261009/);
 assert.match(ps1,/2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42/);
 assert.match(ps1,/demo-bxh-catalog-db01/);
 assert.match(ps1,/DATA01B_SHA256_MISMATCH/);
});
test('runner checks final 197 docs and manual correction preservation',()=>{
 assert.match(ps1,/"verifiedDocuments":197/);
 assert.match(ps1,/"manualCorrectionPreserved":true/);
 assert.match(ps1,/"published":0/);
 assert.match(ps1,/Get-FileHash/);
 assert.match(ps1,/emulators:exec/);
});
test('no production deploy, Firebase project or remote write command',()=>{
 assert.doesNotMatch(ps1,/firebase deploy|git push|gh pr merge|bxh-arena\b(?!_)/i);
 assert.match(ps1,/Remove-Item Env:BXH_CATALOG_DATA01B_FILE/);
});

test('Java is checked only after real-data preflight and optional preflight-only exit',()=>{
 const sha=ps1.indexOf('DATA01B_SHA256_MISMATCH');
 const plan=ps1.indexOf('data01b-preflight.cjs');
 const only=ps1.indexOf('if ($PreflightOnly)');
 const java=ps1.indexOf('JAVA_21_REQUIRED');
 const npm=ps1.indexOf('& npm install');
 assert(sha>=0&&plan>sha&&only>plan&&java>only&&npm>java);
 assert.match(ps1,/param\(\[switch\]\$PreflightOnly\)/);
 assert.match(ps1,/PREFLIGHT_ONLY: No Java, npm or Firestore Emulator required/);
});
test('reusing an existing checkout checks expected origin and branch and never deletes user files',()=>{
 assert.match(ps1,/remote get-url origin/);
 assert.match(ps1,/branch --show-current/);
 assert.match(ps1,/No files overwritten/);
 assert.doesNotMatch(ps1,/Remove-Item\s+\$checkout/);
});
test('Java 21 validation uses Windows PowerShell 5.1 safe stderr capture',()=>{
 assert.match(ps1,/cmd\.exe \/d \/c "java -version 2>&1"/);
 assert.match(ps1,/installed Java is not version 21/);
});
