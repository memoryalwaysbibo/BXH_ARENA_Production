'use strict';
// Build a tracked-file-only Pages artifact; never copy private referee identity/QA sources.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const excluded=p=>p.split('/').some(x=>x.startsWith('.'))||['qr-checkin','referee-certificates','tests'].some(x=>p===x||p.startsWith(x+'/'))||p==='scripts/preview-referee-initialization.cjs';
function prepare(root,destination,files){
 root=path.resolve(root);destination=path.resolve(destination);
 if(destination===root||destination.startsWith(root+path.sep))throw Error('artifact-destination-must-be-outside-checkout');
 if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('artifact-destination-not-empty');
 const plan=JSON.parse(fs.readFileSync(path.join(root,'referee-certificates/functions/initial-preview.json'),'utf8'));
 const identity=fs.readFileSync(path.join(root,'referee-certificates/functions/identities.cjs'),'utf8');
 const uids=[...plan.people.map(p=>p.uid),...Array.from(identity.matchAll(/['"]([A-Za-z0-9_-]{28})['"]/g),m=>m[1])];
 if(plan.people.length!==18||uids.some(x=>typeof x!=='string'||!x))throw Error('private-roster-validation-failed');
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
 for(const flag of ['BXH_REFEREE_CERTIFICATES_V1','BXH_REFEREE_PUBLIC_SUMMARY_V1'])if(!new RegExp('window\\.'+flag+'\\s*=\\s*false\\s*;').test(index))throw Error('referee-rollout-must-remain-closed');
 files=files||cp.execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 fs.mkdirSync(destination,{recursive:true,mode:0o700});let count=0;
 for(const relative of files){
  if(excluded(relative))continue;
  const source=path.resolve(root,relative),target=path.resolve(destination,relative);
  if(!source.startsWith(root+path.sep)||!target.startsWith(destination+path.sep)||!fs.lstatSync(source).isFile())throw Error('unsafe-artifact-path');
  const data=fs.readFileSync(source);
  if(uids.some(uid=>data.includes(Buffer.from(uid))))throw Error('private-referee-identity-in-public-file: '+relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);count++;
 }
 for(const f of ['index.html','modules/main-app/core.js','modules/cloud/cloud-runtime.js','modules/main-app/qr-checkin.js','modules/main-app/qr-checkin-fence.js','modules/main-app/roster-view.js','modules/main-app/bracket-commit.js','modules/referee-license/ui.js','modules/referee-license/domain.js','modules/referee-license/styles.css','modules/referee-license/fonts/bxh-kai-subset.ttf'])if(!fs.existsSync(path.join(destination,f)))throw Error('missing-public-runtime: '+f);
 for(const f of ['referee-certificates','tests','qr-checkin','scripts/preview-referee-initialization.cjs'])if(fs.existsSync(path.join(destination,f)))throw Error('private-path-in-artifact');
 return {files:count,privateIdentityScan:'passed',refereeFlags:'false',privateTreesAbsent:true};
}
if(require.main===module){if(process.argv.length!==3)throw Error('usage: node scripts/prepare-public-pages.cjs OUTSIDE_CHECKOUT_DIRECTORY');console.log(JSON.stringify(prepare(process.cwd(),process.argv[2])));}
module.exports={prepare,excluded};
