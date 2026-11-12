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
 try{
  execFileSync('unzip',['-tqq',archivePath],{timeout:30000,maxBuffer:1024*1024,stdio:'pipe'});
  entries=execFileSync('unzip',['-Z1',archivePath],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024})
   .split(/\r?\n/).filter(Boolean);
 }catch{return blocked('archive-invalid');}
 const counts=new Map();
 for(const name of entries){
  if(name.startsWith('/')||name.includes('\\')||name.split('/').some(part=>part==='..'||part==='.'||part===''))
   return blocked('unsafe-zip-entry',{file:name});
  counts.set(name,(counts.get(name)||0)+1);
  if(counts.get(name)>1)return blocked('duplicate-zip-entry',{file:name});
 }
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
