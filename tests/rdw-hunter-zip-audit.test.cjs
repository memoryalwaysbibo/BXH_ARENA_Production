'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {auditZip}=require('../scripts/lib/rdw-hunter-zip-audit.cjs');
const {gitBlobHash}=require('../scripts/lib/rdw-hunter-source-attestation.cjs');
function archive(entries){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-zip-audit-'));
 const file=path.join(dir,'candidate.zip');
 const python='import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for name,body in json.loads(sys.argv[2]): z.writestr(name,body)';
 execFileSync('python3',['-c',python,file,JSON.stringify(entries)],{timeout:10000});
 const expectedSha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 return {file,expectedSha256,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('audits real ZIP bytes but never marks a candidate approved for production',()=>{
 const entries=[['vendor/',''],['reader.cjs','reader-v1'],['vendor/a.js','helper-v1']];
 const z=archive(entries);
 try{
  const expectedBlobs={'reader.cjs':gitBlobHash(Buffer.from('reader-v1')),'vendor/a.js':gitBlobHash(Buffer.from('helper-v1'))};
  const result=auditZip({archivePath:z.file,expectedSha256:z.expectedSha256,expectedBlobs});
  assert.equal(result.candidateVerified,true);
  assert.equal(result.checkedFiles,2);
  assert.equal(result.releaseApproved,false);
  assert.equal(result.deploymentGenerationVerified,false);
  assert.equal(result.iamVerified,false);
 }finally{z.cleanup();}
});
test('incorrect ZIP digest and missing files always fail closed',()=>{
 const z=archive([['reader.cjs','reader-v1']]);
 try{
  const expectedBlobs={'reader.cjs':gitBlobHash(Buffer.from('reader-v1')),'missing.cjs':gitBlobHash(Buffer.from('x'))};
  assert.equal(auditZip({archivePath:z.file,expectedSha256:'0'.repeat(64),expectedBlobs}).reason,'archive-sha256-mismatch');
  assert.equal(auditZip({archivePath:z.file,expectedSha256:z.expectedSha256,expectedBlobs}).reason,'candidate-file-missing');
  assert.equal(auditZip({archivePath:z.file,expectedSha256:z.expectedSha256,
   expectedBlobs:{'reader.cjs':gitBlobHash(Buffer.from('bad'))}}).reason,'candidate-source-mismatch');
 }finally{z.cleanup();}
});
test('ZIP traversal and duplicate members are rejected',()=>{
 for(const entries of [
  [['../escape.js','x'],['reader.cjs','ok']],
  [['reader.cjs','ok'],['reader.cjs','replacement']]
 ]){
  const z=archive(entries);
  try{
   const result=auditZip({archivePath:z.file,expectedSha256:z.expectedSha256,
    expectedBlobs:{'reader.cjs':gitBlobHash(Buffer.from('ok'))}});
   assert.equal(result.candidateVerified,false);
   assert.ok(['unsafe-zip-entry','duplicate-zip-entry','archive-invalid'].includes(result.reason),result.reason);
  }finally{z.cleanup();}
 }
});
test('invalid path or digest cannot pass',()=>{
 assert.equal(auditZip().candidateVerified,false);
 assert.equal(auditZip({archivePath:'/not/existing.zip',expectedSha256:'a'.repeat(64)}).reason,'archive-unreadable');
});

test('rejects ZIP symlinks, encrypted flags and oversized expanded members',()=>{
 const scenarios=[
  ['symlink', 'symlink-zip-entry'],
  ['oversized', 'zip-entry-size-invalid']
 ];
 for(const [kind,expected] of scenarios){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-zip-special-'));
  try{
   const file=path.join(dir,'special.zip');
   const script=[
    'import sys,zipfile,stat',
    'with zipfile.ZipFile(sys.argv[1],"w",compression=zipfile.ZIP_DEFLATED) as z:',
    ' if sys.argv[2]=="symlink":',
    '  i=zipfile.ZipInfo("reader.cjs");i.create_system=3;i.external_attr=(stat.S_IFLNK | 0o777)<<16;z.writestr(i,"/tmp/target")',
    ' else: z.writestr("reader.cjs",b"x"*(4*1024*1024+1))'
   ].join('\n');
   execFileSync('python3',['-c',script,file,kind],{timeout:10000});
   const expectedSha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
   const out=auditZip({archivePath:file,expectedSha256,expectedBlobs:{'reader.cjs':gitBlobHash(Buffer.from('x'))}});
   assert.equal(out.candidateVerified,false);
   assert.equal(out.reason,expected);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('empty expected manifest cannot silently approve any ZIP',()=>{
 const z=archive([['reader.cjs','sample']]);
 try{
  for(const expectedBlobs of [{}, {'reader.cjs':'not-a-git-blob'}]){
   const result=auditZip({archivePath:z.file,expectedSha256:z.expectedSha256,expectedBlobs});
   assert.equal(result.reason,'expected-fingerprints-invalid');
   assert.equal(result.releaseApproved,false);
  }
 }finally{z.cleanup();}
});
