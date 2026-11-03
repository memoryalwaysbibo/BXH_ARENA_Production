'use strict';
// Actual candidate business handlers and QR proxy, actual browser app functions.
// SDK transport, actor identity and business clock are fixtures; not real sign-in.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NODE_PATH||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const uiRoot=path.resolve(__dirname,'../../..'),rankedRoot=path.resolve(process.env.BXH_RANKED_SOURCE||'.integration/ranked'),generalRoot=path.resolve(process.env.BXH_GENERAL_SOURCE||'.integration/general');
const R=require(path.join(rankedRoot,'tests/four-court-buckets/settlement/probe.cjs'));
const G=require(path.join(generalRoot,'tests/four-court-buckets/completion/fixture.cjs'));
const {createGeneralCompletion}=require(path.join(generalRoot,'release/buckets/completion/general-completion.cjs'));
const {sources}=require('./probe.cjs'),{harness}=require('./host-harness.cjs');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.BXH_TEST_BROWSER});let checks=0;
 try{for(const kind of ['ranked','general'])for(const courts of [4,6,12])for(const qr of [false,true])for(const lost of [false,true]){
  const f=(kind==='ranked'?R:G).fixture({courts,qr}),spec=kind==='ranked'?R.specs.find(s=>s.function==='settleLadderTournament'):null;
  const handler=kind==='ranked'?R.load(spec,true,f.m):createGeneralCompletion(f.m.db,{runtime:'emulator',env:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188'},clock:()=>G.NOW});
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  let calls=0;
  await page.exposeFunction('__readCloudDoc',p=>f.m.rows.get(p)||null);
  await page.exposeFunction('__callCloudBackend',async(mode,payload)=>{
   assert.equal(mode,kind);calls++;
   return kind==='ranked'?handler.invoke({expectedRoom:payload.expectedRoom}):handler({auth:{uid:'admin'},data:payload});
  });
  await page.route('https://settlement.fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Candidate backend handoff</title>'}));
  await page.goto('https://settlement.fixture.test/');
  await page.addScriptTag({content:'(function(){const module={exports:{}};'+fs.readFileSync(path.join(uiRoot,'referee-seats/functions/bucket-state.cjs'),'utf8')+';globalThis.BXHMatchBuckets=module.exports;})();'});
  await page.addScriptTag({path:path.join(uiRoot,'modules/scoring/four-court-settlement.js')});
  const fixture={top:f.top,pub:f.pub,buckets:f.buckets},options={kind,role:'admin',mode:lost?'lost':'success'},src=sources();
  const result=await page.evaluate('('+harness.toString()+')('+JSON.stringify(src)+','+JSON.stringify(fixture)+','+JSON.stringify(options)+')');
  assert.equal(result.ok,true,kind+' '+courts+' qr='+qr+' lost='+lost);assert.equal(result.cloudWrites,0);assert.equal(result.legacy,0);assert.equal(calls,1);
  const top=f.m.rows.get('tournaments/'+f.state.cloudCode);assert.equal(top.archiveStatus,'completed');
  const logCount=f.m.writes.filter(w=>w.path.startsWith('ladderTransactions/')).length;assert.equal(logCount,kind==='ranked'?4:0);
  const before=JSON.stringify([...f.m.rows]);
  // Fresh app invocation reads completion without calling an award endpoint again.
  const completed={...fixture,top,pub:f.m.rows.get('publicTournaments/'+f.state.cloudCode)};
  const replay=await page.evaluate('('+harness.toString()+')('+JSON.stringify(src)+','+JSON.stringify(completed)+','+JSON.stringify({...options,mode:'success'})+')');assert(replay.ok);assert.equal(calls,1);assert.equal(JSON.stringify([...f.m.rows]),before);
  checks++;
  await context.close();
 }}finally{await browser.close();}
 console.log(JSON.stringify({candidateBackendBrowserChecks:checks,productionRequests:0,productionWrites:0,scope:'actual ranked/general candidate handlers and browser app functions; fixture SDK/auth/clock, no full-host or real authentication'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
