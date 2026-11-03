'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require('playwright');
let server,browser,origin;const modes=new Map(),hits=new Map(),commits=new Map();
before(async()=>{
 server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),key=url.pathname.split('/')[1];
  if(url.pathname.endsWith('/offline.js')){res.setHeader('content-type','application/javascript');res.end(fs.readFileSync('offline-resilience.js'));return;}
  if(url.pathname.endsWith('/commit')){
   let raw='';for await(const part of req)raw+=part;
   const op=JSON.parse(raw),list=hits.get(key)||[];list.push(op.id);hits.set(key,list);
   const mode=modes.get(key)||'success';
   if(mode==='network'){req.socket.destroy();return;}
   if(mode==='lost-ack'){commits.set(key,new Set([...(commits.get(key)||[]),op.id]));modes.set(key,'success');req.socket.destroy();return;}
   if(mode==='conflict'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,reason:'player-mismatch'}));return;}
   commits.set(key,new Set([...(commits.get(key)||[]),op.id]));res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true}));return;
  }
  res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Isolated offline queue test</title><script src="/'+key+'/offline.js"></script><script>window.BXHCommitOfflineMatch=op=>fetch("/'+key+'/commit",{method:"POST",body:JSON.stringify(op)}).then(r=>r.json());</script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
});
after(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
let seq=0;
async function fixture(t){const key='case'+(++seq),context=await browser.newContext(),page=await context.newPage();t.after(()=>context.close());await page.goto(origin+'/'+key+'/');await context.setOffline(true);return {key,context,page};}
const payload={tournamentCode:'BXH-INTERNAL97',matchId:'m1',dispatchRevision:0,selectedWinnerId:'p1',mode:'score'};
test('real browser offline: sequential duplicate clicks preserve one IndexedDB operation',async t=>{
 const {page}=await fixture(t);const ids=await page.evaluate(async p=>{const ids=[];for(let i=0;i<20;i++)ids.push((await BXHOfflineQueue.enqueue(p)).id);return ids;},payload);assert.equal(new Set(ids).size,1);assert.equal(await page.evaluate(async()=>(await BXHOfflineQueue.counts()).total),1);
});
test('real browser offline: concurrent duplicate enqueue does not create duplicate operations',async t=>{
 const {page}=await fixture(t);const ids=await page.evaluate(async p=>Promise.all(Array.from({length:20},async()=> (await BXHOfflineQueue.enqueue(p)).id)),payload);console.log('OFFLINE_DUPLICATE_RESULT',JSON.stringify({parallelRequests:20,distinctOperations:new Set(ids).size}));assert.equal(new Set(ids).size,1,'parallel enqueue must preserve one intent');
});
test('two browser tabs atomically deduplicate the same offline intent',async t=>{
 const {page,context,key}=await fixture(t);await context.setOffline(false);const second=await context.newPage();await second.goto(origin+'/'+key+'/');await context.setOffline(true);
 const submit=p=>p.evaluate(async op=>Promise.all(Array.from({length:10},async()=> (await BXHOfflineQueue.enqueue(op)).id)),payload);
 const ids=(await Promise.all([submit(page),submit(second)])).flat();assert.equal(new Set(ids).size,1);assert.equal((await page.evaluate(()=>BXHOfflineQueue.counts())).total,1);
});
test('different actors and different scores are never collapsed into the same intent',async t=>{
 const {page}=await fixture(t);const ids=await page.evaluate(async p=>Promise.all([{...p,actorUid:'a',scoreA:4},{...p,actorUid:'b',scoreA:4},{...p,actorUid:'a',scoreA:5}].map(async op=>(await BXHOfflineQueue.enqueue(op)).id)),payload);assert.equal(new Set(ids).size,3);
});
test('an existing v1 queue record deduplicates without changing its ID or upgrading IndexedDB',async t=>{
 const {page}=await fixture(t);await page.evaluate(p=>new Promise((resolve,reject)=>{const r=indexedDB.open('bxh-arena-offline-v1',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('operations',{keyPath:'id'});s.createIndex('status','status');s.createIndex('createdAt','createdAt');};r.onsuccess=()=>{const tx=r.result.transaction('operations','readwrite');tx.objectStore('operations').put({...p,id:'old-pending-001',fingerprint:'legacy-five-field-signature',status:'retry',createdAt:1,attempts:2});tx.oncomplete=()=>{r.result.close();resolve();};tx.onerror=()=>reject(tx.error);};}),payload);
 const id=await page.evaluate(async p=>(await BXHOfflineQueue.enqueue(p)).id,payload);assert.equal(id,'old-pending-001');
});
test('receipt verification refuses changed or unrelated completed results',async t=>{
 const {page}=await fixture(t);const result=await page.evaluate(()=>{
  const op={id:'operation-original',actorUid:'ref',tournamentCode:'BXH-TEST',matchId:'m',station:1,dispatchRevision:0,mode:'score',playerAId:'a',playerBId:'b',selectedWinnerId:'a',scoreA:4,scoreB:0,log:[],faultActions:[]};
  const m={id:'m',station:1,dispatchRevision:0,a:{playerId:'a'},b:{playerId:'b'},winnerId:'a',completed:true,confirmedAt:100,resultMethod:'score',scoreA:4,scoreB:0,log:[],faultActions:[]};m.offlineConfirmationReceipt=BXHOfflineQueue.confirmationReceipt(op,m);
  const checks=[BXHOfflineQueue.matchesConfirmationReceipt(op,m)];
  for(const patch of [{id:'other-match'},{winnerId:'b'},{scoreA:5},{confirmedAt:101},{station:2},{dispatchRevision:1},{completed:false},{a:{playerId:'changed'}},{resultMethod:'quick_decision'},{log:[{points:4}]},{offlineConfirmationReceipt:undefined}])checks.push(!BXHOfflineQueue.matchesConfirmationReceipt(op,{...m,...patch}));
  checks.push(!BXHOfflineQueue.matchesConfirmationReceipt({...op,id:'another-operation'},m));checks.push(!BXHOfflineQueue.matchesConfirmationReceipt({...op,actorUid:'other'},m));return checks;
 });assert(result.every(Boolean));
});
test('real browser reconnect: stored confirmation replays once and clears queue',async t=>{
 const {key,page,context}=await fixture(t);await page.evaluate(p=>BXHOfflineQueue.enqueue(p),payload);assert.equal((hits.get(key)||[]).length,0);await context.setOffline(false);await page.evaluate(()=>BXHOfflineQueue.replay());await page.waitForFunction(async()=> (await BXHOfflineQueue.counts()).total===0);assert.equal(commits.get(key).size,1);
});
test('real browser reload: queue persists and a lost acknowledgement reuses the operation ID',async t=>{
 const {key,page,context}=await fixture(t);const op=await page.evaluate(p=>BXHOfflineQueue.enqueue(p),payload);modes.set(key,'network');await context.setOffline(false);await page.reload();assert.equal((await page.evaluate(()=>BXHOfflineQueue.all()))[0].id,op.id);modes.set(key,'lost-ack');await page.evaluate(()=>BXHOfflineQueue.replay());await page.evaluate(()=>BXHOfflineQueue.replay());await page.waitForFunction(async()=> (await BXHOfflineQueue.counts()).total===0);assert.equal(commits.get(key).size,1);assert((hits.get(key)||[]).every(id=>id===op.id));
});
test('real browser stale-player conflict stays queued for review without automatic overwrite',async t=>{
 const {key,page,context}=await fixture(t);modes.set(key,'conflict');await page.evaluate(p=>BXHOfflineQueue.enqueue(p),payload);await context.setOffline(false);await page.evaluate(()=>BXHOfflineQueue.replay());assert.equal((await page.evaluate(()=>BXHOfflineQueue.counts())).conflict,1);const before=hits.get(key).length;await page.evaluate(()=>BXHOfflineQueue.replay());assert.equal(hits.get(key).length,before);assert(!commits.has(key));
});
test('real browser persistent network failure reaches retry limit and explicit retry recovers',async t=>{
 const {key,page,context}=await fixture(t);modes.set(key,'network');await page.evaluate(p=>BXHOfflineQueue.enqueue(p),payload);await context.setOffline(false);for(let i=0;i<8;i++)await page.evaluate(()=>BXHOfflineQueue.replay());assert.equal((await page.evaluate(()=>BXHOfflineQueue.counts())).failed,1);modes.set(key,'success');await page.evaluate(()=>BXHOfflineQueue.retryFailed());await page.evaluate(()=>BXHOfflineQueue.replay());assert.equal((await page.evaluate(()=>BXHOfflineQueue.counts())).total,0);assert.equal(commits.get(key).size,1);
});
test('actual core replay bridge recovers a committed result after its acknowledgement is lost',async t=>{
 const {page,context}=await fixture(t);
 const core=fs.readFileSync('modules/main-app/core.js','utf8'),a=core.indexOf('window.BXHCommitOfflineMatch=async function(op){'),b=core.indexOf('\n  window.addEventListener("bxh-offline-operation-synced"',a);assert(a>0&&b>a);
 // Transaction adapter deliberately loses only the acknowledgement after commit.
 // Source bridge is unchanged; state propagation and score evaluation are fixture stubs.
 await page.addScriptTag({content:`
  const currentAuthUid=()=> 'ref',rebuildPropagationForState=s=>s;
  const evaluateMatchCompletion=m=>({ok:true,winnerId:'a',loserId:'b'}),evaluateQuickDecision=evaluateMatchCompletion;
  const applyMatchCompletionFields=(m,e)=>Object.assign(m,{completed:true,winnerId:e.winnerId,loserId:e.loserId,resultMethod:'score',confirmedAt:Date.now()}),applyQuickDecisionFields=applyMatchCompletionFields;
  let remote={matches:[{id:'m1',station:1,dispatchRevision:0,a:{playerId:'a'},b:{playerId:'b'},scoreA:0,scoreB:0,completed:false}]},lose=true;window.actualCommits=0;
  window.cloudSync={confirmMatchTransaction:async(code,mutate)=>{const candidate=structuredClone(remote),r=mutate(candidate);if(!r.ok||r.alreadyApplied)return r;remote=candidate;window.actualCommits++;if(lose){lose=false;throw Error('network');}return r;}};
  ${core.slice(a,b)}
 `});
 await page.evaluate(p=>BXHOfflineQueue.enqueue({...p,actorUid:'ref',station:1,playerAId:'a',playerBId:'b',selectedWinnerId:'a',scoreA:4,scoreB:0}),payload);
 await context.setOffline(false);await page.evaluate(()=>BXHOfflineQueue.replay());await page.evaluate(()=>BXHOfflineQueue.replay());
 assert.equal(await page.evaluate(()=>window.actualCommits),1,'server result must never be applied twice');
 const counts=await page.evaluate(()=>BXHOfflineQueue.counts());console.log('OFFLINE_ACK_RESULT',JSON.stringify({counts,operations:await page.evaluate(async()=> (await BXHOfflineQueue.all()).map(x=>({status:x.status,lastError:x.lastError,attempts:x.attempts}))),actualCommits:await page.evaluate(()=>window.actualCommits)}));assert.equal(counts.total,0,'already committed identical result must clear the pending queue after lost acknowledgement');
});
