'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const digest=data=>createHash('sha256').update(data).digest('hex');
const backend=['domain.cjs','service.cjs','callable.cjs','cloud/server-entry.cjs','cloud/deploy-preflight.cjs'];
const frontend=['controller.mjs','pairing.mjs','scanner.mjs','cloud/config.mjs','cloud/transport.mjs','cloud/boot.mjs','cloud/mobile.mjs','cloud/mobile.css','cloud/index.html','cloud/firebase-sdk-entry.mjs','vendor/qrcode.min.js','vendor/jsQR.js','vendor/jsQR-LICENSE.txt','vendor/qrcode-LICENSE.txt','vendor/README.md'];
async function buildBundle({output,sourceCommit,clientConfig=null}){
  const destination=path.resolve(output);
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('invalid-source-commit');
  if(!path.basename(destination).startsWith('hc01-cloud-test-')||destination.startsWith(path.dirname(ROOT)+path.sep)||fs.existsSync(destination))throw Error('unsafe-output-path');
  const {validateConfig,ORIGINS}=await import('./config.mjs');
  const config=clientConfig?validateConfig(clientConfig,ORIGINS[0]):{enabled:false,projectId:'bxh-hc-test',authDomain:'bxh-hc-test.firebaseapp.com',apiKey:'',appId:'',appCheckSiteKey:''};
  fs.mkdirSync(destination,{mode:0o700});
  const write=(relative,data)=>{const target=path.join(destination,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data,{flag:'wx'});};
  try{
    for(const name of backend)write('functions/hc01/'+name,fs.readFileSync(path.join(ROOT,name)));
    for(const name of ['server/runtime-boundary.cjs','emulator/preflight.cjs'])write('functions/'+name,fs.readFileSync(path.join(ROOT,'..',name)));
    for(const name of frontend)write('public/'+name,fs.readFileSync(path.join(ROOT,name)));
    write('public/index.html',fs.readFileSync(path.join(ROOT,'cloud/index.html')));
    write('public/cloud/client-config.json',JSON.stringify(config,null,2)+'\n');
    write('functions/package.json',JSON.stringify({name:'hunter-clash-hc01-cloud-test',private:true,version:'0.0.1',main:'hc01/cloud/server-entry.cjs',engines:{node:'22'},dependencies:{'firebase-admin':'14.5.0','firebase-functions':'7.4.0'}},null,2)+'\n');
    write('package.json',JSON.stringify({name:'hunter-clash-hc01-cloud-candidate',private:true,scripts:{'build:web':'node build-web.cjs'},devDependencies:{firebase:'12.19.0',esbuild:'0.25.5','firebase-tools':'15.30.0'}},null,2)+'\n');
    write('build-web.cjs',`'use strict';\nconst fs=require('node:fs'),{createHash}=require('node:crypto');\nprocess.chdir(__dirname);\nrequire('esbuild').build({entryPoints:['public/cloud/firebase-sdk-entry.mjs'],bundle:true,format:'esm',platform:'browser',minify:true,outfile:'public/cloud/firebase-sdk.mjs'}).then(()=>{const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));const file='public/cloud/firebase-sdk.mjs';manifest.files=manifest.files.filter(v=>v.path!==file);manifest.files.push({path:file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});manifest.sdkBundleBuilt=true;fs.writeFileSync('manifest.json',JSON.stringify(manifest,null,2)+'\\n');}).catch(e=>{console.error(e.message);process.exitCode=1;});\n`);
    write('firebase.json',JSON.stringify({functions:{source:'functions',codebase:'hc01-isolated-test',predeploy:['node "$RESOURCE_DIR/hc01/cloud/deploy-preflight.cjs"']},hosting:{site:'bxh-hc-test-hc01',public:'public',predeploy:['node functions/hc01/cloud/deploy-preflight.cjs'],ignore:['**/firebase-sdk-entry.mjs'],headers:[{source:'**',headers:[{key:'Cache-Control',value:'no-store'},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Content-Type-Options',value:'nosniff'}]}]}},null,2)+'\n');
    // No Firestore deployment config: existing HC00 rules must be inspected, not overwritten.
    const files=fs.readdirSync(destination,{recursive:true}).sort().filter(p=>fs.statSync(path.join(destination,p)).isFile()).map(p=>({path:p,sha256:digest(fs.readFileSync(path.join(destination,p)))}));
    const manifest={kind:'HC01_CLOUD_TEST_CANDIDATE',projectId:'bxh-hc-test',siteId:'bxh-hc-test-hc01',sourceCommit,clientConfigured:!!clientConfig,appCheckEnforced:true,accountAllowlistRequired:true,productionEntryEnabled:false,deploymentPerformed:false,sdkBundleBuilt:false,files};
    write('manifest.json',JSON.stringify(manifest,null,2)+'\n');return manifest;
  }catch(error){fs.rmSync(destination,{recursive:true,force:true});throw error;}
}
if(require.main===module){const [output,sourceCommit,configPath]=process.argv.slice(2);buildBundle({output,sourceCommit,clientConfig:configPath?JSON.parse(fs.readFileSync(configPath,'utf8')):null}).then(m=>process.stdout.write('Prepared '+m.kind+'; not deployed.\n')).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={buildBundle};
