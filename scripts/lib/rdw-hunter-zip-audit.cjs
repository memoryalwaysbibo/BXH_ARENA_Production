'use strict';
// Offline source ZIP audit. Uses the supplied ZIP bytes and expected digest.
// Does NOT establish that the ZIP was downloaded from the LIVE Cloud Function.
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {SOURCE,gitBlobHash}=require('./rdw-hunter-source-attestation.cjs');
const MAX_ARCHIVE_BYTES=50*1024*1024;
function auditZip({archivePath,expectedSha256,expectedBlobs=SOURCE.candidateGitBlobs}={}){
 const blocked=(reason,extra={})=>({candidateVerified:false,releaseApproved:false,reason,...extra});
 if(!expectedBlobs||typeof expectedBlobs!=='object'||Array.isArray(expectedBlobs)||!Object.keys(expectedBlobs).length||
    Object.values(expectedBlobs).some(hash=>typeof hash!=='string'||!(/^[a-f0-9]{40}$/.test(hash))))
  return blocked('expected-fingerprints-invalid');
 if(typeof archivePath!=='string'||!archivePath||typeof expectedSha256!=='string'||!(/^[a-f0-9]{64}$/.test(expectedSha256)))
  return blocked('archive-or-expected-digest-missing');
 let bytes;
 try{
  const stat=fs.statSync(archivePath);
  if(!stat.isFile()||stat.size<=0||stat.size>MAX_ARCHIVE_BYTES)return blocked('archive-size-invalid');
  bytes=fs.readFileSync(archivePath);
 }catch{return blocked('archive-unreadable');}
 const actualSha256=createHash('sha256').update(bytes).digest('hex');
 if(actualSha256!==expectedSha256)return blocked('archive-sha256-mismatch',{actualSha256});
 let entries;
 // Check the central directory BEFORE any decompression to reject oversized,
 // encrypted, symlink and suspicious members. Names come from JSON, not a
 // newline-delimited listing, so filenames containing newlines fail safely.
 try{
  const inspect=[
   'import json,stat,sys,zipfile',
   'with zipfile.ZipFile(sys.argv[1]) as z:',
   ' print(json.dumps([{"name":i.filename,"size":i.file_size,"encrypted":bool(i.flag_bits & 1),"mode":i.external_attr >> 16} for i in z.infolist()]))'
  ].join('\n');
  entries=JSON.parse(execFileSync('python3',['-c',inspect,archivePath],
   {encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}));
 }catch{return blocked('archive-invalid');}
 if(!Array.isArray(entries)||!entries.length||entries.length>256)return blocked('archive-entry-count-invalid');
 const counts=new Map();
 let totalUncompressed=0;
 for(const entry of entries){
  const name=entry?.name;
  if(typeof name!=='string'||!name||name.includes('\0')||name.includes('\r')||name.includes('\n')||
     name.startsWith('/')||name.includes(String.fromCharCode(92))||
     (name.endsWith('/')?name.slice(0,-1):name).split('/').some(part=>part==='..'||part==='.'||part===''))
   return blocked('unsafe-zip-entry',{file:name});
  if(entry.encrypted===true)return blocked('encrypted-zip-entry',{file:name});
  const fileType=entry.mode & 0xf000;
  if(fileType===0xa000)return blocked('symlink-zip-entry',{file:name});
  if(fileType!==0 && fileType!==0x8000 && fileType!==0x4000)
   return blocked('unsupported-zip-entry-type',{file:name});
  if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>4*1024*1024)
   return blocked('zip-entry-size-invalid',{file:name});
  totalUncompressed+=entry.size;
  if(totalUncompressed>64*1024*1024)return blocked('zip-uncompressed-size-invalid');
  counts.set(name,(counts.get(name)||0)+1);
  if(counts.get(name)>1)return blocked('duplicate-zip-entry',{file:name});
 }
 try{execFileSync('unzip',['-tqq',archivePath],{timeout:30000,maxBuffer:1024*1024,stdio:'pipe'});}
 catch{return blocked('archive-invalid');}
 for(const [file,expected] of Object.entries(expectedBlobs)){
  if(counts.get(file)!==1)return blocked('candidate-file-missing',{file});
  let content;
  try{content=execFileSync('unzip',['-p',archivePath,file],{timeout:30000,maxBuffer:2*1024*1024});}
  catch{return blocked('candidate-file-unreadable',{file});}
  if(gitBlobHash(content)!==expected)return blocked('candidate-source-mismatch',{file});
 }
 return {candidateVerified:true,releaseApproved:false,
  reason:'archive-matches-pinned-candidate-only',
  actualSha256,checkedFiles:Object.keys(expectedBlobs).length,
  deploymentGenerationVerified:false,iamVerified:false,runtimeIntegrationVerified:false};
}
module.exports={auditZip,MAX_ARCHIVE_BYTES};
if(require.main===module){
 const [archivePath,expectedSha256]=process.argv.slice(2);
 const result=auditZip({archivePath,expectedSha256});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(!result.candidateVerified)process.exitCode=1;
}
