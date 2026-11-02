'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {writeManifest}=require('../scripts/write-release-manifest.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bxh-release-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const contents={'version.json':JSON.stringify({version:'v14.3.42',build:'20261030.3'}),'index.html':'index','modules/main-app/core.js':'core','modules/cloud/cloud-runtime.js':'cloud'};
 for(const [f,s]of Object.entries(contents)){fs.mkdirSync(path.dirname(path.join(root,f)),{recursive:true});fs.writeFileSync(path.join(root,f),s);}
 const metadata={repository:'memoryalwaysbibo/BXH_ARENA_Production',sourceCommit:'a'.repeat(40),checkoutCommit:'a'.repeat(40),validationRunId:'123',deploymentRunId:'456',deploymentAttempt:'1',artifactCreatedAt:'2026-11-02T00:00:00.000Z'};
 return {root,metadata,contents};
}
test('manifest identifies the actual artifact without changing source version labels or claiming successful publication',t=>{
 const f=fixture(t),m=writeManifest(f.root,f.metadata);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'release.json'))),m);
 for(const [p,s]of Object.entries(f.contents)){assert.equal(fs.readFileSync(path.join(f.root,p),'utf8'),s);assert.equal(m.files[p],crypto.createHash('sha256').update(s).digest('hex'));}
 assert.equal(m.sourceCommit,'a'.repeat(40));assert.equal(m.legacyBuild,'20261030.3');assert.equal(m.deploymentRunUrl,'https://github.com/memoryalwaysbibo/BXH_ARENA_Production/actions/runs/456');
 assert.equal(m.deployedAt,undefined);assert.equal(m.status,undefined);
});
test('wrong checkout, repository or malformed run identity cannot create a release record',t=>{
 for(const patch of [{checkoutCommit:'b'.repeat(40)},{sourceCommit:'bad'},{repository:'other/repo'},{validationRunId:'0'},{deploymentRunId:'bad'},{deploymentAttempt:'-1'}]){
  const f=fixture(t);assert.throws(()=>writeManifest(f.root,{...f.metadata,...patch}));assert.equal(fs.existsSync(path.join(f.root,'release.json')),false);
 }
});
test('missing runtime or malformed version prevents a partial release record',t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.root,'modules/main-app/core.js'));assert.throws(()=>writeManifest(f.root,f.metadata));assert.equal(fs.existsSync(path.join(f.root,'release.json')),false);
 const g=fixture(t);fs.writeFileSync(path.join(g.root,'version.json'),'{}');assert.throws(()=>writeManifest(g.root,g.metadata),/version-label/);assert.equal(fs.existsSync(path.join(g.root,'release.json')),false);
});
test('an existing manifest is never silently overwritten',t=>{const f=fixture(t);writeManifest(f.root,f.metadata);const before=fs.readFileSync(path.join(f.root,'release.json'),'utf8');assert.throws(()=>writeManifest(f.root,{...f.metadata,deploymentAttempt:'2'}),/already-exists/);assert.equal(fs.readFileSync(path.join(f.root,'release.json'),'utf8'),before);});
test('invalid timestamps are rejected instead of inventing a publication date',t=>{for(const value of ['invalid','2026-02-30T00:00:00.000Z','2026-11-02']){const f=fixture(t);assert.throws(()=>writeManifest(f.root,{...f.metadata,artifactCreatedAt:value}),/artifact-time/);}});
test('CLI binds metadata to the real checkout and rejects an unrelated validated commit',t=>{
 const cp=require('node:child_process'),f=fixture(t),script=path.resolve(__dirname,'../scripts/write-release-manifest.cjs');
 const git=(...args)=>cp.execFileSync('git',args,{cwd:f.root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 const sha=git('rev-parse','HEAD');
 const env={...process.env,GITHUB_REPOSITORY:f.metadata.repository,EXPECTED_COMMIT:sha,VALIDATION_RUN_ID:'123',GITHUB_RUN_ID:'456',GITHUB_RUN_ATTEMPT:'1'};
 cp.execFileSync(process.execPath,[script,f.root],{cwd:f.root,env,stdio:'pipe'});
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'release.json'))).sourceCommit,sha);
 fs.unlinkSync(path.join(f.root,'release.json'));
 assert.throws(()=>cp.execFileSync(process.execPath,[script,f.root],{cwd:f.root,env:{...env,EXPECTED_COMMIT:'b'.repeat(40)},stdio:'pipe'}));
 assert.equal(fs.existsSync(path.join(f.root,'release.json')),false);
});
