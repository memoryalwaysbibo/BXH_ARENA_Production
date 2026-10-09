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
