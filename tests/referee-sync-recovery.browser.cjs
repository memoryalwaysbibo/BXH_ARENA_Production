'use strict';
// Isolated browser acceptance with real reload/localStorage and simulated cloud/auth.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function extract(name){let a=core.indexOf('function '+name+'(');const b=core.indexOf('\n}',a);assert(a>=0&&b>a,name);if(core.slice(a-6,a)==='async ')a-=6;return core.slice(a,b+2);}
const functions=['canUseRefereeSyncRecovery','refereeSyncRecoveryControlsHtml','requestRefereeSyncRecovery','performRefereeSyncRecovery','exportRefereeSyncRecovery','flushCloudStateWrites'].map(extract).join('\n');
const html=`<!doctype html><meta charset="utf-8"><style>body{font-family:sans-serif;background:#111;color:white;margin:20px}button{padding:12px;margin:4px}.hint{margin:12px 0}</style><main id="app"></main><div id="modal"></div><p id="toast"></p><script src="/recovery.js"></script><script>
const params=new URLSearchParams(location.search),uid='lab-ref';
const first=!localStorage.getItem('lab-boot');localStorage.setItem('lab-boot','yes');
let state=JSON.parse(localStorage.getItem('lab-cache')||JSON.stringify({id:'room',cloudCode:'BXH-RECOV1',startedAt:1,meta:{battleMode:'individual'},players:[],matches:[{id:'m1',scoreA:4}]}));
let cloudStatus=first?'error':'connected',cloudWriteChain=first?(params.has('pending')?new Promise(()=>{}):Promise.resolve(false)):Promise.resolve();
let pendingModal=null;window.cloudWrites=0;
window.storage={set:async(key,value)=>{if(params.has('quota')&&key.startsWith('bxh-referee-sync-recovery:'))throw Error('quota');localStorage.setItem(key,value);return {key,value};},get:async key=>{const value=localStorage.getItem(key);return value===null?null:{key,value};}};
window.cloudSync={joinRoom:async(code,options)=>{if(options?.serverOnly!==true)throw Error('server-only required');if(params.has('readFail'))return {ok:false};const remote=JSON.parse(JSON.stringify(state));remote.matches[0].scoreA=3;return {ok:true,data:remote};},pushUpdate:async()=>{window.cloudWrites++;throw Error('cloud writes forbidden');}};
function currentAuthUid(){return uid;}function canOperateCurrentTournament(){return true;}
async function saveRecord(remote){localStorage.setItem('lab-cache',JSON.stringify(remote));return true;}
function rememberRefereeWorkstation(){}function showToast(message){document.getElementById('toast').textContent=message;}
function openModal(mm){pendingModal=mm;document.getElementById('modal').innerHTML='<p>'+mm.message+'</p><button id="accept">'+mm.confirmLabel+'</button><button id="cancel">取消</button>';document.getElementById('accept').onclick=()=>{pendingModal=null;document.getElementById('modal').innerHTML='';mm.onConfirm();};document.getElementById('cancel').onclick=()=>{pendingModal=null;document.getElementById('modal').innerHTML='';};}
${functions}
function render(){document.getElementById('app').innerHTML='<p id="score">雲端核對分數：'+state.matches[0].scoreA+'</p>'+refereeSyncRecoveryControlsHtml();document.querySelector('[data-action="referee-sync-recovery"]').onclick=requestRefereeSyncRecovery;document.querySelector('[data-action="referee-export-recovery"]').onclick=exportRefereeSyncRecovery;}
window.readGate=flushCloudStateWrites;render();
</script>`;
(async()=>{
 let browser,server;const results=[];
 try{
  server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/recovery.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/recovery.js'?fs.readFileSync('modules/main-app/referee-sync-recovery.js','utf8'):html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  for(const width of [390,1280])for(const scenario of ['failed','pending','quota','readFail']){
   const context=await browser.newContext({viewport:{width,height:844},acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/?'+(scenario==='failed'?'':scenario+'=1'));
   if(scenario==='failed')assert.equal(await page.evaluate(()=>window.readGate()),false);
   await page.click('[data-action="referee-sync-recovery"]');await page.click('#cancel');assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('bxh-referee-sync-recovery:'))),false);
   await page.click('[data-action="referee-sync-recovery"]');
   if(['failed','pending'].includes(scenario)){
    await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.click('#accept')]);
    assert.equal(await page.evaluate(()=>window.readGate()),true);assert.match(await page.textContent('#score'),/3$/);
    assert.equal(await page.evaluate(()=>window.cloudWrites),0);
    const downloadPromise=page.waitForEvent('download');await page.click('[data-action="referee-export-recovery"]');const download=await downloadPromise;
    const data=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(data.snapshot.matches[0].scoreA,4);assert.equal(data.uid,'lab-ref');
   }else{
    await page.click('#accept');await page.waitForFunction(()=>document.getElementById('toast').textContent.length>0);
    assert.match(await page.textContent('#score'),/4$/);assert.equal(await page.evaluate(()=>window.readGate()),false);
    assert.equal(await page.evaluate(()=>window.cloudWrites),0);assert.match(await page.textContent('#toast'),/停止|無法讀取/);
   }
   assert.deepEqual(errors,[]);results.push({width,scenario,passed:true});await context.close();
  }
 }finally{
  const out=path.resolve('test-results/referee-sync-recovery');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({scope:'isolated core controls/callbacks; real browser reload/storage; simulated cloud/auth',results},null,2));
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
 }
 console.log('PASS recovery browser: '+results.length+' scenarios; no cloud writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
