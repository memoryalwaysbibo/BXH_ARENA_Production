const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {verifyBundle,loadVerifiedReader,EXPECTED_FILES}=require('../scripts/lib/rdw-hunter-bundle-loader.cjs');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-hunter-'));fs.mkdirSync(path.join(root,'vendor'));const files=Object.fromEntries(EXPECTED_FILES.map(name=>[name,name==='reader.cjs'?'module.exports={createReader:()=>async()=>({})};':'{}']));const manifest={};for(const [name,content] of Object.entries(files)){fs.writeFileSync(path.join(root,name),content);manifest[name]=hash(content);}return {root,manifest};}
test('verified local bundle loads reader without grant service',()=>{const f=fixture();assert.equal(verifyBundle(f).checked,15);assert.equal(typeof loadVerifiedReader(f),'function');});
test('tampered source fails closed',()=>{const f=fixture();fs.writeFileSync(path.join(f.root,'reader.cjs'),'tampered');assert.throws(()=>loadVerifiedReader(f),/hash-mismatch/);});
test('unsafe manifest path fails closed',()=>{const f=fixture();f.manifest['../secrets']='a'.repeat(64);assert.throws(()=>verifyBundle(f),/incomplete-or-unexpected-manifest/);});
test('omitted dependency fails closed',()=>{const f=fixture();delete f.manifest['vendor/canonical.js'];assert.throws(()=>verifyBundle(f),/incomplete-or-unexpected-manifest/);});
