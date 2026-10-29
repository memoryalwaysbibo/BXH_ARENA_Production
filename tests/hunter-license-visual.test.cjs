'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function setup(){const c=vm.createContext({window:{},URL});for(const file of ['hunter-license-v21','hunter-license-visual'])vm.runInContext(fs.readFileSync('modules/main-app/'+file+'.js','utf8'),c);return c.window;}
test('approved v9.1.1 PNGs and complete material CSS remain byte-exact',()=>{
 const dir='assets/hunter-ranks/license-v911/',manifest=JSON.parse(fs.readFileSync(dir+'manifest.json'));
 assert.equal(manifest.sourceHtmlSha256,'24b4e9f648a975537df61059cc6a1fbde4248ce251741d518094b00669871c34');
 assert.deepEqual(manifest.files.map(f=>f.tier),['ungraded','e','d','c','b','a','s','national']);
 for(const f of manifest.files){const bytes=fs.readFileSync(dir+f.tier+'.png');assert.equal(bytes.length,f.bytes);assert.equal(sha(bytes),f.sha256);}
 assert.equal(sha(fs.readFileSync('modules/main-css/hunter-license-visual.css').subarray(0,16494)),'e6fd02ac5d5269e8bf94418f812fee2aaa658d0ba6fd5bafdb24543df97f7902');
});
test('one current-grade image is requested, never peak or equipped title',()=>{
 const w=setup();for(const tier of w.BXHHunterLicenseVisual.grades){
  const currentGrade=w.BXHHunterLicenseV21.displayGrade({grade:{tier},life:{},highest:{tier:'national'}},null);
  const html=w.BXHHunterLicenseVisual.render({name:'名字',currentGrade,profile:{equippedTitle:'national'},highestTier:'national'});
  assert.equal((html.match(/assets\/hunter-ranks\//g)||[]).length,1);assert.ok(html.includes('/'+tier+'.png'));
 }
});
test('pending and unknown tiers do not request an unearned badge',()=>{
 const v=setup().BXHHunterLicenseVisual;
 for(const tier of ['pending','diamond','__proto__',null]){const html=v.render({currentGrade:{tier,label:'對手資料待核對'}});assert.ok(html.includes('對手資料待核對'));assert.ok(!html.includes('assets/hunter-ranks/'));}
});
test('runtime ignores sample serials, legacy IDs and unverified dates',()=>{
 const v=setup().BXHHunterLicenseVisual,html=v.render({sample:true,serial:1,profile:{uid:'secret',playerId:'P123',gameId:'G123',licenseNumber:1,joinedAt:'2026-01-01',creationTime:1}});
 for(const value of ['secret','P123','G123','00001','2026-01-01'])assert.ok(!html.includes(value));
 assert.ok(html.includes('待配號'));assert.ok(html.includes('待核對'));
});
test('names and grade labels escape markup; unsafe avatar schemes fall back',()=>{
 const v=setup().BXHHunterLicenseVisual;assert.ok(!v.render({name:'<script>"&\'😀',currentGrade:{label:'<img onerror=x>'}}).includes('<script>'));
 for(const avatarUrl of ['javascript:alert(1)','file:///tmp/x','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,broken!','/relative.png'])assert.ok(!v.render({profile:{avatarUrl}}).includes('<img'));
 assert.ok(v.render({profile:{avatarUrl:'https://example.test/a.png'}}).includes('referrerpolicy="no-referrer"'));
});
test('caller retains current grade and existing growth, with renderer before core',()=>{
 const core=fs.readFileSync('modules/main-app/core.js','utf8'),index=fs.readFileSync('index.html','utf8');
 assert.ok(core.includes('render({name:playerName,profile:p,currentGrade:licenseGrade,numberIdentity:hunterProfileCache?.numberIdentity,accountUid:currentAuthUid()})'));
 assert.ok(core.includes('displayGrade?.(licenseOverview,hunterProfileCache?.permanentLicense)||licenseOverview.grade'));
 assert.ok(core.includes('window.BXHArenaPK?.practiceGrowth?.(licenseOverview.growth)||licenseOverview.growth'));
 assert.ok(index.indexOf('hunter-license-visual.js?')<index.indexOf('modules/main-app/core.js?'));
});
