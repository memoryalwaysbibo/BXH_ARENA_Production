'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
async function served(t,emulator){
 const port=emulator?4197:4196;
 const child=spawn(process.execPath,['tests/e2e/static-server.cjs'],{cwd:root,env:{...process.env,PORT:String(port),BXH_E2E_EMULATOR:emulator?'1':'0',BXH_TEST_EMULATOR_APP_CHECK:'1',BXH_TEST_TRACE_FIRESTORE:'',BXH_TEST_FIREBASE_SDK_DIR:''},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{if(String(chunk).includes('test server listening'))resolve();});child.once('error',reject);child.once('exit',code=>reject(Error('server exited '+code)));});
 const response=await fetch(`http://127.0.0.1:${port}/modules/cloud/cloud-runtime.js`);assert.equal(response.status,200);return response.text();
}
test('test App Check flag cannot alter non-emulator runtime',async t=>{
 assert.equal(await served(t,false),fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8'));
});
test('synthetic provider requires loopback, demo project and explicit emulator query',async t=>{
 const source=await served(t,true);
 const provider=source.match(/provider: (new mod\.CustomProvider\(\{getToken:async\(\)=>\{[\s\S]*?\}\}\)),/)[1];
 function getToken(host,project,search){return vm.runInNewContext(provider,{mod:{CustomProvider:class{constructor(options){return options;}}},location:{hostname:host,search},FIREBASE_CONFIG:{projectId:project},URLSearchParams,Date,Error}).getToken();}
 const valid=await getToken('127.0.0.1','demo-bxh-arena-e2e','?bxh_e2e=1');
 assert.equal(valid.token,'synthetic-emulator-app-check');assert(valid.expireTimeMillis>Date.now());
 for(const args of [['arena.bxh.com.tw','demo-bxh-arena-e2e','?bxh_e2e=1'],['127.0.0.1','bxh-arena','?bxh_e2e=1'],['127.0.0.1','demo-bxh-arena-e2e','']])await assert.rejects(getToken(...args),/emulator-app-check-only/);
});
