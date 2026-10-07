'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
async function checkCandidate(root){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const firebase=JSON.parse(fs.readFileSync(path.join(root,'firebase.json'),'utf8'));
  const blocked=[];const add=(id,pass)=>{if(!pass)blocked.push(id);};
  add('isolated-project',manifest.kind==='HC01_CLOUD_TEST_CANDIDATE'&&manifest.projectId==='bxh-hc-test'&&manifest.siteId==='bxh-hc-test-hc01'&&manifest.productionEntryEnabled===false);
  add('deployment-scope',firebase.functions?.source==='functions'&&firebase.functions?.codebase==='hc01-isolated-test'&&firebase.hosting?.site==='bxh-hc-test-hc01'&&!firebase.firestore);
  add('sdk-built',manifest.sdkBundleBuilt===true&&fs.existsSync(path.join(root,'public/cloud/firebase-sdk.mjs')));
  const digest=data=>createHash('sha256').update(data).digest('hex');
  const safe=record=>typeof record?.path==='string'&&!path.isAbsolute(record.path)&&!record.path.split(/[\\/]/).includes('..')&&typeof record.sha256==='string';
  add('source-integrity',Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.every(record=>{if(!safe(record))return false;try{return digest(fs.readFileSync(path.join(root,record.path)))===record.sha256;}catch{return false;}}));
  try{const {validateConfig,ORIGINS}=await import('./config.mjs');validateConfig(JSON.parse(fs.readFileSync(path.join(root,'public/cloud/client-config.json'),'utf8')),ORIGINS[0]);}
  catch{blocked.push('web-app-and-app-check-config');}
  return{status:blocked.length?'BLOCKED':'CANDIDATE_CHECKS_PASS',blocked,projectId:'bxh-hc-test',sourceCommit:manifest.sourceCommit,
    cloudVerified:false,notVerified:['deployment-identity-and-IAM','hosting-site-exists','auth-provider-and-test-accounts','app-check-registration','server-config-and-allowlist','published-firestore-rules','deployed-function-and-phone-test']};
}
if(require.main===module)checkCandidate(process.argv[2]||process.cwd()).then(result=>{process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.blocked.length)process.exitCode=1;}).catch(()=>{process.stderr.write('Candidate could not be checked.\n');process.exitCode=1;});
module.exports={checkCandidate};
