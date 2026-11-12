'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateSourceDir,run}=require('./rdw-hunter-real-reader-emulator.cjs');
test('real Reader harness rejects missing or unpinned source bundle',()=>{
 assert.throws(()=>validateSourceDir('relative/path'),/absolute-hunter-source-dir-required/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-real-reader-fixture-'));
 try{
  fs.writeFileSync(path.join(dir,'reader.cjs'),'module.exports={createReader(){}}');
  assert.throws(()=>validateSourceDir(dir),/source-blob-mismatch:reader.cjs/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('real Reader harness refuses non-emulator runtime and fake player identity',async()=>{
 await assert.rejects(run({sourceDir:'/not/a/source',db:{},uid:'player'}),/auth-and-firestore-emulators-required|emulator-db-required|isolated-fixture-uid-required/);
});
