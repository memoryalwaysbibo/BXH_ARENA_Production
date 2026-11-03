'use strict';
// Actual index/router/modal/cloud adapter; only Firebase transport and data are fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NODE_PATH||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const backend=require('./deletion-probe.cjs');
const root=path.resolve(__dirname,'../../..'),origin='https://bucket-delete.fixture.test',code=backend.code,key='bxh:delete-tournament:v1:admin:'+code;
const sdk=`
const auth={currentUser:{uid:'admin',email:'admin@example.invalid',getIdToken:async()=> 'local-fixture'}};
export const initializeApp=()=>({}),getApp=()=>({}),getFirestore=()=>({}),getFunctions=()=>({}),initializeAuth=()=>{window.__testAuth=auth;return auth;},getAuth=()=>auth;
export const browserLocalPersistence={},browserSessionPersistence={};
export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(a.currentUser),0);return ()=>{};};
export const getRedirectResult=async()=>null;
export const doc=(base,...parts)=>({path:[base.path,...parts].filter(Boolean).join('/')}),collection=doc,collectionGroup=doc;
export const query=(r,...filters)=>({...r,filters}),where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,or=(...x)=>x,startAfter=(...x)=>x;
const snap=(r,value)=>({id:r.path?.split('/').at(-1),exists:()=>value!=null,data:()=>value});
export const getDoc=async r=>snap(r,await window.__fixtureRead(r.path)),getDocFromServer=getDoc;
export const getDocs=async()=>({docs:[],empty:true,size:0,forEach:()=>{}}),getCountFromServer=async()=>({data:()=>({count:0})});
export const onSnapshot=(r,cb)=>{setTimeout(()=>{if(typeof cb==='function')cb({docs:[],empty:true,size:0,docChanges:()=>[],forEach:()=>{},exists:()=>false,data:()=>null});},0);return ()=>{};};
export const serverTimestamp=()=>1,increment=x=>x,deleteField=()=>null;
export const setDoc=async(r,v)=>window.__fixtureWrite(r.path),updateDoc=setDoc,deleteDoc=setDoc;
export const writeBatch=()=>({set(){return this},update(){return this},delete(){return this},commit:async()=>{}});
export const httpsCallable=(f,name,options)=>async payload=>({data:await window.__fixtureCall(name,payload,options)});
export const signOut=async()=>{},setPersistence=async()=>{},getToken=async()=>({token:'local-fixture'}),initializeAppCheck=()=>({});
export class ReCaptchaEnterpriseProvider{};
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BXH_TEST_BROWSER,args:['--no-sandbox']});let checks=0;
 try{
 for(const viewport of [{width:1440,height:1100},{width:390,height:844}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(12000);
  let m,mod,mode='success',acknowledged=false,publicPresent=false,holdResolve,holdStarted,notifyHold;
  const calls=[],errors=[],external=[],served=new Set(),browserWrites=[];
  function reset(){m=backend.fixture();mod=backend.load(m);acknowledged=false;publicPresent=false;mode='success';}
  reset();
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('__fixtureWrite',p=>{browserWrites.push(p);});
  await page.exposeFunction('__fixtureRead',p=>{
   if(p==='users/admin')return {role:'super_admin',active:true,realName:'隔離測試管理員',nickname:'本機測試',email:'admin@example.invalid',phone:'0900000000',gameId:'fixture-admin'};
   if(p==='ladderSystem/current')return {currentSeason:'S1',startAt:1,endAt:4102444800000,seasonLengthMonths:4,status:'active'};
   if(p==='publicTournaments/'+code&&publicPresent)return {name:'等待確認'};
   return m.rows.get(p)?.data||null;
  });
  await page.exposeFunction('__fixtureCall',async(name,payload)=>{
   if(name==='listManagementTournamentSummaries')return {ok:true,pageSize:5,hasMore:false,nextCursor:null,counts:{open:1,upcoming:0,closed:0,draft:0,all:1},items:acknowledged?[]:[{code,name:'隔離刪房驗收',createdBy:'admin',eventAuthority:'official',registrationStatus:'open',tournamentPhase:'waiting',archiveStatus:'ongoing',ladderMode:'general'}]};
   if(name==='deleteTournamentSafely'){
    calls.push({...payload});
    if(mode==='hold'){notifyHold();await new Promise(resolve=>holdResolve=resolve);}
    if(mode==='review')throw Error('deletion-worker-requires-review');
    const result=await mod.deleteTournamentSafely({auth:{uid:'admin'},data:payload});
    if(mode==='lost'){mode='success';throw Error('synthetic-lost-response');}
    if(result.ok&&result.deleted)acknowledged=true;
    return result;
   }
   return {ok:true,items:[],events:[],players:[],entries:[],records:[],invitations:[],notifications:[],unread:0};
  });
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='www.gstatic.com'&&u.pathname.includes('/firebasejs/'))return route.fulfill({contentType:'application/javascript',body:sdk});
   if(u.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
   if(u.hostname==='cdnjs.cloudflare.com'&&u.pathname.includes('qrcode'))return route.fulfill({contentType:'application/javascript',body:'/* QR not exercised */'});
   if(u.origin!==origin){external.push(u.origin);return route.abort();}
   const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   served.add(path.relative(root,file));return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream'});
  });
  async function open(){await page.goto(origin,{waitUntil:'load'});await page.waitForFunction(()=>currentAuthUid()==='admin'&&appPhase==='app');
   const tab=page.locator('[data-action="switch-tab"][data-tab="management"]');if(await tab.count())await tab.first().click();
   await page.locator('[data-action="cloud-admin-delete-tournament"]').first().waitFor();}
  async function remove(){await page.locator('[data-action="cloud-admin-delete-tournament"]').first().click();await page.locator('[data-action="modal-confirm"]').click();}
  async function toast(text){await page.waitForFunction(t=>document.body.textContent.includes(t),text);}
  try{
   // Lost response after the actual candidate backend has committed; reload and replay.
   mode='lost';await open();await remove();await toast('尚未確認刪除完成');
   const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);assert(saved.operationId);assert(!m.rows.has('tournaments/'+code));
   assert(!(await page.locator('body').textContent()).includes('刪除失敗，房間仍保留'));checks++;
   await page.reload({waitUntil:'load'});await page.locator('[data-action="cloud-admin-delete-tournament"]').first().waitFor();await remove();await toast('已刪除賽事：');
   assert.equal(calls.at(-1).operationId,saved.operationId);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);checks++;
   // A still-active canonical worker returns pending, never another traversal.
   reset();const canonical='operator-canonical-0001',job=await mod._private.claim({uid:'admin',code,operationId:canonical});await open();const before=m.recursive.length;
   await remove();await toast('刪除作業仍在處理中');assert.equal(m.recursive.length,before);assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).operationId,key),canonical);checks++;
   await mod._private.pause(job);await remove();await toast('已刪除賽事：');assert.equal(calls.at(-1).operationId,canonical);checks++;
   // Public entry still present: no success, intent retained, then confirmed retry.
   reset();publicPresent=true;await open();await remove();await toast('尚未確認刪除完成');assert(await page.evaluate(k=>!!localStorage.getItem(k),key));checks++;
   publicPresent=false;acknowledged=false;await page.reload({waitUntil:'load'});await page.locator('[data-action="cloud-admin-delete-tournament"]').first().waitFor();await remove();await toast('已刪除賽事：');checks++;
   // Browser storage denial stops before the callable (no hidden new operation).
   reset();await open();await page.evaluate(()=>{window.__originalGet=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k.startsWith('bxh:delete-tournament:'))throw Error('storage-blocked');return window.__originalGet.call(this,k);};});const beforeCalls=calls.length;
   await remove();await toast('本次未送出刪除');assert.equal(calls.length,beforeCalls);checks++;
   // A changed authenticated account cannot confirm a late response as success.
   reset();mode='hold';holdStarted=new Promise(resolve=>notifyHold=resolve);await open();await remove();await holdStarted;
   await page.evaluate(()=>{window.__testAuth.currentUser={uid:'other'};});holdResolve();await toast('登入帳號已變更');assert(await page.evaluate(k=>!!localStorage.getItem(k),key));checks++;
   // Explicit operator-review state must not recommend another delete request.
   reset();mode='review';await open();await remove();await toast('請保留操作編號並停止重試');assert(await page.evaluate(k=>!!localStorage.getItem(k),key));checks++;
   for(const f of ['index.html','modules/main-app/core.js','modules/cloud/cloud-runtime.js','modules/management-v2/adapter.js'])assert(served.has(f),f);
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(!browserWrites.some(p=>/^(tournaments|publicTournaments)\//.test(p)));checks++;
  }catch(e){console.error(JSON.stringify({viewport,errors,external,missingButton:await page.locator('[data-action="cloud-admin-delete-tournament"]').count(),body:(await page.locator('body').textContent()).slice(-3000)}));throw e;}
  finally{await context.close();}
 }
 console.log(JSON.stringify({fullHostBrowserChecks:checks,viewports:2,productionWrites:0,productionRequests:0,firebaseTransport:'local fixture',backend:'actual candidate with in-memory database'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
