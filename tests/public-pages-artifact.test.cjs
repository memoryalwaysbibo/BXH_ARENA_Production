'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepare}=require('../scripts/prepare-public-pages.cjs');
function fixture(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'pages-safety-')),root=path.join(base,'repo'),out=path.join(base,'public');fs.mkdirSync(root);t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const files=[];
 const put=(f,data)=>{fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.writeFileSync(path.join(root,f),data);if(!files.includes(f))files.push(f);};
 const uid='private-fixture-identity';
 put('referee-certificates/functions/initial-preview.json',JSON.stringify({people:Array.from({length:18},(_,i)=>({uid:uid+i,name:'Private fixture '+i}))}));
 put('referee-certificates/functions/identities.cjs',"const ALIAS='abcdefghijklmnopqrstuvwxyz12';");
 put('index.html','window.BXH_REFEREE_CERTIFICATES_V1 = false; window.BXH_REFEREE_PUBLIC_SUMMARY_V1 = false;');
 for(const f of ['modules/main-app/core.js','modules/cloud/cloud-runtime.js','modules/main-app/qr-checkin.js','modules/main-app/qr-checkin-fence.js','modules/main-app/roster-view.js','modules/main-app/bracket-commit.js','modules/referee-license/ui.js','modules/referee-license/domain.js','modules/referee-license/styles.css','modules/referee-license/fonts/bxh-kai-subset.ttf'])put(f,'runtime');
 for(const f of ['tests/private-audit.json','qr-checkin/reference/private.json','scripts/preview-referee-initialization.cjs','.git/config'])put(f,uid+'0');
 return {root,out,files,put,uid};}
test('artifact excludes complete referee backend, identity table, QA data and preview; preserves runtime bytes',t=>{const f=fixture(t);assert.equal(prepare(f.root,f.out,f.files).privateIdentityScan,'passed');assert.equal(fs.readFileSync(path.join(f.out,'modules/referee-license/ui.js'),'utf8'),'runtime');for(const p of ['referee-certificates','tests','qr-checkin','scripts/preview-referee-initialization.cjs','.git'])assert.equal(fs.existsSync(path.join(f.out,p)),false);});
test('unexpected roster or alias UID anywhere in public bytes fails closed',t=>{for(const uid of ['private-fixture-identity0','abcdefghijklmnopqrstuvwxyz12']){const f=fixture(t);f.put('unexpected.txt',uid);assert.throws(()=>prepare(f.root,f.out,f.files),/private-referee-identity/);}});
test('enabled referee flag prevents publishing',t=>{const f=fixture(t);f.put('index.html','window.BXH_REFEREE_CERTIFICATES_V1 = true; window.BXH_REFEREE_PUBLIC_SUMMARY_V1 = false;');assert.throws(()=>prepare(f.root,f.out,f.files),/rollout-must-remain-closed/);});
test('missing public runtime and unsafe staging destination prevent upload',t=>{const f=fixture(t);assert.throws(()=>prepare(f.root,f.root,f.files),/outside-checkout/);assert.throws(()=>prepare(f.root,f.out,f.files.filter(x=>!x.endsWith('styles.css'))),/missing-public-runtime/);});
