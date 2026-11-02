'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {build,boot,project}=require('./full-page-source.cjs'),source=fs.readFileSync(path.resolve(__dirname,'../../modules/cloud/cloud-runtime.js'),'utf8');
test('full-page adapter removes live SDK/config dependencies without changing deployment source',()=>{
 const served=build(source);new vm.Script(served);new vm.Script(boot);
 assert(source.includes('const FOUR_COURT_CLIENT_ROLLOUT = false;'));
 assert(served.includes('const FOUR_COURT_CLIENT_ROLLOUT = true;'));
 assert(served.includes('FIREBASE_CONFIG.projectId === "'+project+'"'));
 assert(!served.includes('await import(`https://www.gstatic.com/firebasejs/'));
 assert(!served.includes('new mod.ReCaptchaEnterpriseProvider('));
 assert(!served.includes('projectId: "bxh-arena"'));
});
test('test bootstrap refuses non-loopback execution before touching any SDK',()=>{
 for(const hostname of ['arena.bxh.com.tw','localhost','127.0.0.2'])assert.throws(()=>vm.runInNewContext(boot,{location:{hostname}}),/emulator-only/);
});
test('adapter refuses source drift that could bypass pinned project, rollout or emulator connections',()=>{
 for(const anchor of ['const FOUR_COURT_CLIENT_ROLLOUT = false;','FIREBASE_CONFIG.projectId === "bxh-arena"','dbHandle = fsMod.getFirestore(app);','functionsHandle = functionsMod.getFunctions(app,"asia-east1");','new mod.ReCaptchaEnterpriseProvider(ARENA_APP_CHECK_SITE_KEY)'])assert.throws(()=>build(source.replace(anchor,'/* source changed */')),/source anchor changed/);
});
