'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const repository='memoryalwaysbibo/BXH_ARENA_Production';
const paths=['version.json','index.html','modules/main-app/core.js','modules/cloud/cloud-runtime.js'];
function writeManifest(directory,metadata){
 const {sourceCommit,checkoutCommit,validationRunId,deploymentRunId,deploymentAttempt,artifactCreatedAt}=metadata;
 if(!/^[a-f0-9]{40}$/.test(sourceCommit||'')||sourceCommit!==checkoutCommit)throw Error('validated-checkout-mismatch');
 if(metadata.repository!==repository)throw Error('unexpected-repository');
 for(const value of [validationRunId,deploymentRunId,deploymentAttempt])if(typeof value!=='string'||! /^[1-9][0-9]*$/.test(value))throw Error('invalid-run-identity');
 if(typeof artifactCreatedAt!=='string'||!Number.isFinite(Date.parse(artifactCreatedAt))||new Date(artifactCreatedAt).toISOString()!==artifactCreatedAt)throw Error('invalid-artifact-time');
 const target=path.join(directory,'release.json');
 if(fs.existsSync(target))throw Error('release-manifest-already-exists');
 const files={};
 for(const relative of paths){
  const file=path.join(directory,relative);
  if(!fs.lstatSync(file).isFile())throw Error('invalid-release-file');
  files[relative]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 }
 const version=JSON.parse(fs.readFileSync(path.join(directory,'version.json'),'utf8'));
 if(typeof version.version!=='string'||typeof version.build!=='string')throw Error('invalid-version-label');
 const manifest={schemaVersion:1,repository,sourceCommit,validationRunId,deploymentRunId,deploymentAttempt,artifactCreatedAt,
  deploymentRunUrl:`https://github.com/${repository}/actions/runs/${deploymentRunId}`,
  legacyVersion:version.version,legacyBuild:version.build,files};
 // Created before upload; this intentionally makes no claim about deployment success or completion time.
 fs.writeFileSync(target,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return manifest;
}
if(require.main===module){
 if(process.argv.length!==3)throw Error('usage: write-release-manifest.cjs PUBLIC_SITE_DIRECTORY');
 const env=process.env;
 writeManifest(process.argv[2],{repository:env.GITHUB_REPOSITORY,sourceCommit:env.EXPECTED_COMMIT,
  checkoutCommit:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  validationRunId:env.VALIDATION_RUN_ID,deploymentRunId:env.GITHUB_RUN_ID,deploymentAttempt:env.GITHUB_RUN_ATTEMPT,
  artifactCreatedAt:new Date().toISOString()});
}
module.exports={writeManifest};
