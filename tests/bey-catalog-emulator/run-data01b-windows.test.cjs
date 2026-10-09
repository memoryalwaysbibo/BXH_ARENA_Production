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

test('offline preflight verifies pinned raw SHA and 197 records before Git/Node/Java',()=>{
 const sha=ps1.indexOf('DATA01B_SHA256_MISMATCH');
 const only=ps1.indexOf('if ($PreflightOnly)');
 const git=ps1.indexOf('foreach ($cmd in @("git","node"))');
 const java=ps1.indexOf('JAVA_21_REQUIRED');
 assert(sha>=0&&only>sha&&git>only&&java>git);
 assert(ps1.includes('param([switch]$PreflightOnly, [switch]$InstallJava)'));
 assert(ps1.includes('Get-Content -LiteralPath $fixture -Raw -Encoding UTF8 | ConvertFrom-Json'));
 assert.match(ps1,/DATA01B_SECTION_COUNT_MISMATCH/);
 assert.match(ps1,/DATA01B_EXPECTED_197/);
 assert.match(ps1,/PREFLIGHT_ONLY: no Java, Node, Git, npm or Firestore writes required/);
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

test('Java setup requires explicit InstallJava opt-in and never runs in offline preflight',()=>{
 assert(ps1.includes('param([switch]$PreflightOnly, [switch]$InstallJava)'));
 const preflight=ps1.indexOf('if ($PreflightOnly)');
 const install=ps1.indexOf('if ($InstallJava)');
 const git=ps1.indexOf('foreach ($cmd in @("git","node"))');
 assert(preflight>0&&install>preflight&&git>install);
 assert(ps1.includes('winget install --id EclipseAdoptium.Temurin.21.JDK --exact'));
 assert(ps1.includes('if ($LASTEXITCODE -ne 0) { throw "JAVA_INSTALL_FAILED'));
 assert(ps1.includes('No Emulator write attempted.'));
 assert(ps1.includes('Close this terminal, open a new PowerShell window'));
});
