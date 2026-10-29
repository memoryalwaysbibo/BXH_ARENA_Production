'use strict';
// Full index + unmodified host/router/adapter scripts. Only feature flags and Firebase transport are fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const {MockDB,fixture,user}=require('../referee-certificates/test/mock-db.cjs');
const {createService}=require('../referee-certificates/functions/service.cjs');
const {createPublicSummary}=require('../referee-certificates/functions/public-summary.cjs');
const root=path.join(__dirname,'..'),origin='https://full-host.fixture.test';
const db=new MockDB({...fixture(),'users/admin':user('super_admin',{realName:'測試管理員',displayName:'測試管理員',email:'admin@example.invalid'}),'users/bob':user('player',{realName:'延遲回應甲'}),'users/carol':user('player',{realName:'目前對象乙'}),'users/alice':user('player',{realName:'測試裁判',gameId:'測試裁判'}),'systemConfig/refereeCertificatesV1':{enabled:true,publicSummaryEnabled:true},'refereeCertificateSystem/numbering':{lastIssuedNumber:18},'ladderSystem/current':{currentSeason:'S1',startAt:Date.parse('2026-10-01T00:00:00+08:00'),endAt:Date.parse('2027-01-31T23:59:59.999+08:00'),seasonLengthMonths:4,status:'active'},'ladderSeasons/S1':{seasonId:'S1',status:'active'}});
let gate=true,holdUid=null,releaseHeld=null,notifyHeld;let heldStarted;
const service=createService(db),pub=createPublicSummary(db),calls=[],errors=[],external=[],served=new Set();
const sdk=`
const auth={currentUser:{uid:'admin',email:'admin@example.invalid',getIdToken:async()=> 'local-fixture'}};
export const initializeApp=()=>({}),getApp=()=>({}),getFirestore=()=>({}),getFunctions=()=>({}),initializeAuth=()=>auth,getAuth=()=>auth;
export const browserLocalPersistence={},browserSessionPersistence={};
export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(a.currentUser),0);return ()=>{};};
export const getRedirectResult=async()=>null;
export const doc=(base,...parts)=>({path:[base.path,...parts].filter(Boolean).join('/')}),collection=doc,collectionGroup=doc;
export const query=(r,...filters)=>({...r,filters}),where=(...x)=>x,orderBy=(...x)=>x,limit=x=>x,or=(...x)=>x;
const snap=(r,value)=>({id:r.path?.split('/').at(-1),exists:()=>value!=null,data:()=>value});
export const getDoc=async r=>snap(r,await window.__fixtureRead(r.path)),getDocFromServer=getDoc;
export const getDocs=async r=>{const rows=await window.__fixtureQuery(r);const docs=rows.map(x=>snap({path:x.path},x.value));return {docs,empty:!docs.length,size:docs.length,forEach:fn=>docs.forEach(fn)};},getCountFromServer=async()=>({data:()=>({count:0})});
export const onSnapshot=(r,cb)=>{setTimeout(()=>{if(typeof cb==='function')cb({docs:[],empty:true,size:0,docChanges:()=>[],forEach:()=>{},exists:()=>false,data:()=>null});},0);return ()=>{};};
export const serverTimestamp=()=>1,increment=x=>x,deleteField=()=>null;
export const setDoc=async()=>{},updateDoc=async()=>{},deleteDoc=async()=>{};
export const writeBatch=()=>({set(){return this},update(){return this},delete(){return this},commit:async()=>{}});
export const httpsCallable=(f,name,options)=>async payload=>{const data=await window.__fixtureCall(name,payload,options);(window.__fixtureCompletions||=[]).push({name,payload});return {data};};
export const signOut=async()=>{},setPersistence=async()=>{},getToken=async()=>({token:'local-fixture'}),initializeAppCheck=()=>({});
export class ReCaptchaEnterpriseProvider{};
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BXH_TEST_BROWSER,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:'block'});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__fixtureQuery',r=>db.list(r.path).filter(([,v])=>(r.filters||[]).every(f=>!Array.isArray(f)||f[1]!=='=='||v[f[0]]===f[2])).map(([path,value])=>({path,value})));
 await page.exposeFunction('__fixtureRead',p=>db.read(p)||null);
 await page.exposeFunction('__fixtureCall',async(name,payload,options)=>{
  calls.push({name,payload,options});
  if(name==='refereeCertificateService'){const result=await service({auth:{uid:'admin'},data:payload});if(payload.action==='get'&&payload.targetUid===holdUid){notifyHeld();await new Promise(resolve=>releaseHeld=resolve);}return result;}
  if(name==='refereeCertificatePublicSummary')return pub({auth:{uid:'admin'},data:payload});
  if(name==='playerCardService')return payload.action==='search'?{ok:true,players:[{uid:'alice',name:'測試裁判',playerId:'FIXTURE'}],hasMore:false}:{ok:true,card:{uid:'alice',name:'測試裁判',playerId:'FIXTURE'}};
  return {ok:true,items:[],events:[],players:[],entries:[],records:[],invitations:[],notifications:[],unread:0};
 });
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='www.gstatic.com'&&u.pathname.includes('/firebasejs/'))return route.fulfill({contentType:'application/javascript',body:sdk});
  if(u.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
  if(u.hostname==='cdnjs.cloudflare.com'&&u.pathname.includes('qrcode'))return route.fulfill({contentType:'application/javascript',body:'/* optional QR library unused in this flow */'});
  if(u.origin!==origin){external.push(u.origin);return route.abort();}
  let file=path.join(root,u.pathname==='/'?'index.html':decodeURIComponent(u.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
  served.add(path.relative(root,file));let body=fs.readFileSync(file);
  if(file.endsWith('/index.html')&&gate)body=body.toString().replace(/(BXH_REFEREE_CERTIFICATES_V1\s*=\s*)false/g,'$1true').replace(/(BXH_REFEREE_PUBLIC_SUMMARY_V1\s*=\s*)false/g,'$1true');
  return route.fulfill({headers:{date:new Date().toUTCString()},body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.ttf')?'font/ttf':'application/octet-stream'});
 });
 await page.goto(origin,{waitUntil:'load'});
 await page.waitForFunction(()=>currentAuthUid()==='admin'&&appPhase==='app');
 await page.locator('[data-action="toggle-account-menu"]').click();
 await page.locator('[data-action="open-account-management"]').click();
 await page.locator('[data-action="account-role-filter"][data-role="player"]').click();
 await page.locator('[data-account-uid="alice"]').waitFor({state:'attached'});
 assert.equal(await page.locator('[data-action="account-role-filter"][data-role="player"]').getAttribute('aria-pressed'),'true');
 assert.ok((await page.locator('#app').textContent()).includes('帳號管理'));
 await page.locator('[data-account-uid="alice"]>summary').press('Enter');
 await page.locator('[data-account-uid="alice"] [data-action="account-manage-referee"]').click();
 await page.waitForFunction(()=>activeTab==='referee-admin'&&document.getElementById('app').textContent.includes('UID：alice'));
 assert.ok(!calls.some(c=>c.name==='refereeCertificateService'&&c.payload.action==='search'),'detail entry must not search again');
 await page.locator('[data-referee-approval="personId"]').fill('person-alice');
 await page.locator('[data-referee-approval="basis"]').fill('full host fixture identity verified');
 await page.locator('[data-action="referee-license-grant"]').click();
 await page.waitForFunction(()=>document.getElementById('app').textContent.includes('正式階級已授予。'),null,{timeout:8000});
 assert.equal(db.read('refereeCertificates/alice').awardedLevel,1);
 await page.locator('[data-action="switch-tab"][data-tab="ladder"]').click();
 await page.waitForFunction(()=>ladderPublicLoaded&&!ladderPublicLoading);
 await page.locator('details:has(#player-card-query)>summary').press('Enter');
 await page.locator('#player-card-query').fill('測試裁判');
 await page.locator('[data-action="card-search"]').click();
 await page.locator('[data-action="card-open"][data-uid="alice"]').waitFor({state:'attached'});
 const searchPanel=page.locator('details:has(#player-card-query)');if(await searchPanel.getAttribute('open')===null)await searchPanel.locator('summary').press('Enter');
 const cardStart=calls.length;
 await page.locator('[data-action="card-open"][data-uid="alice"]').click();
 await page.waitForFunction(()=>document.getElementById('player-card-overlay')?.textContent.includes('R000019'));
 assert.equal(await page.locator('#player-card-overlay .rl-section').count(),1);
 assert.ok((await page.locator('#player-card-overlay .rl-section').textContent()).includes('有效'));
 assert.ok(!calls.slice(cardStart).some(c=>c.name==='refereeCertificateService'));
 assert.deepEqual(calls.slice(cardStart).filter(c=>['playerCardService','refereeCertificatePublicSummary'].includes(c.name)).map(c=>c.name),['playerCardService','refereeCertificatePublicSummary']);
 for(const file of ['index.html','modules/main-app/core.js','modules/main-app/player-cards.js','modules/cloud/cloud-runtime.js','modules/management-v2/adapter.js','modules/management-v2/bootstrap.js','modules/referee-license/ui.js'])assert.ok(served.has(file),file);
 assert.deepEqual(external,[]);
 await page.locator('#player-card-overlay [data-action="card-close"]').click();
 assert.equal(await page.locator('#player-card-overlay').count(),0);
 assert.ok(calls.some(c=>c.name==='playerCardService'&&c.payload.action==='card'));
 assert.ok(calls.some(c=>c.name==='refereeCertificatePublicSummary'&&c.payload.targetUid==='alice'));
 // A slow selected-person response may populate its own cache, never the new target panel.
 async function openDetails(uid){
  await page.locator('[data-action="toggle-account-menu"]').click();
  await page.locator('[data-action="open-account-management"]').click();
  await page.locator('[data-action="account-role-filter"][data-role="player"]').click();
  await page.locator('[data-account-uid="'+uid+'"]>summary').press('Enter');
  await page.locator('[data-account-uid="'+uid+'"] [data-action="account-manage-referee"]').click();
 }
 holdUid='bob';heldStarted=new Promise(resolve=>notifyHeld=resolve);await openDetails('bob');await heldStarted;
 await openDetails('carol');await page.waitForFunction(()=>document.getElementById('app').textContent.includes('UID：carol'));
 releaseHeld();holdUid=null;await page.waitForFunction(()=>window.__fixtureCompletions?.some(c=>c.name==='refereeCertificateService'&&c.payload.action==='get'&&c.payload.targetUid==='bob'));
 const panel=await page.locator('#app').textContent();assert.ok(panel.includes('UID：carol'));assert.ok(!panel.includes('UID：bob'));
 // Actual host reloaded with closed gate / non-super roles: no entry and forged action is inert.
 for(const role of ['super_admin','admin','player']){
  gate=role!=='super_admin';db.put('users/admin',user(role,{realName:'測試操作者',email:'admin@example.invalid'}));
  await page.reload({waitUntil:'load'});await page.waitForFunction(r=>userProfile?.role===r,role);
  if(role==='super_admin'){
   await page.locator('[data-action="toggle-account-menu"]').click();await page.locator('[data-action="open-account-management"]').click();
   await page.locator('[data-action="account-role-filter"][data-role="player"]').click();await page.locator('[data-account-uid="alice"]>summary').press('Enter');
  }
  assert.equal(await page.locator('[data-action="account-manage-referee"]').count(),0);
  const before=calls.filter(c=>c.name==='refereeCertificateService').length;
  await page.evaluate(()=>{const el=document.createElement('button');el.dataset.action='account-manage-referee';el.dataset.uid='alice';document.body.appendChild(el);el.click();el.remove();});
  await page.waitForTimeout(50);assert.equal(calls.filter(c=>c.name==='refereeCertificateService').length,before);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS full index/auth/main navigation -> account player details -> direct exact-UID referee qualification (no search) -> zero-experience L1 approval -> leaderboard player search -> real card overlay/public summary -> close. Real core/router/engagement SDK adapters; local Firebase transport; late target response isolated; closed gate/admin/player entry denied; no production requests.');

 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
