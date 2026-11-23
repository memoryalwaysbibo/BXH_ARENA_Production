'use strict';
// Validation-only. No browser use of the production database or App Check.
const {test,expect}=require('@playwright/test');
const {execFileSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');

const BASE='cbfeb2904d3628e49bfb7527fd1f7f7ab63e1be2';
const APP='http://127.0.0.1:4173', EMU='http://127.0.0.1:8188';
const PROJECT='demo-bxh-arena-r2-websdk';
const DOCS='projects/'+PROJECT+'/databases/(default)/documents';
const SDK='https://www.gstatic.com/firebasejs/10.13.0/';
const HASH={
 'index.html':'a8e29e1bb7772d1923188e0db26406611320203b59b3d6b88d2cf9d8a49f19ec',
 'modules/main-app/core.js':'aa27e8c923e6312f49b2c35bfd9c08db37d04aa631d78f4491d3157ee99219fe',
 'modules/main-app/home-summary-lab.js':'1add3462dc19409e3c2763f282cd31f555459e4e2768fda67ef20f1fe04697e6'
};
const A='BXH-LAB-WITHDRAW', B='BXH-LAB-KEEP';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const p=process.env;
 if(p.GCLOUD_PROJECT!==PROJECT || p.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188'
   || !p.R2_FIXTURE_REPO || !p.R2_FIXTURE_OVERLAY)throw Error('R2 exact demo emulator and exact fixture paths required');
 if(p.GITHUB_ACTIONS==='true'&&(p.GITHUB_EVENT_NAME!=='pull_request'
  || p.GITHUB_BASE_REF!=='main'|| p.GITHUB_HEAD_REF!=='lab/r2-full-home-websdk-20261123'))
   throw Error('R2 dedicated validation draft only');
 const git=(...args)=>execFileSync('git',['-C',p.R2_FIXTURE_REPO,...args],{maxBuffer:16*1024*1024});
 if(git('rev-parse',BASE+'^{commit}').toString().trim()!==BASE)throw Error('R2 pinned source not available');
 const overlay=new Map(Object.entries(HASH).map(([name,hash])=>{
  const body=readFileSync(path.join(p.R2_FIXTURE_OVERLAY,name));
  if(sha(body)!==hash)throw Error('R2 overlay does not match exact reviewed bytes: '+name);
  return [name,body];
 }));
 const shell=overlay.get('index.html').toString();
 if(!shell.includes('commerce.css?v=20261123-ptn-referee.1')||!shell.includes('commerce-ui.js?v=20261123-ptn-referee.1'))
  throw Error('R2 fixture detached from #860 commerce tags');
 return {git,overlay};
}
function makeBootTransport(load){
 const readiness=Promise.resolve().then(load).then(api=>{
  if(api?.synthetic!==true||!['watch','readFirst','readDelta'].every(k=>typeof api[k]==='function'))throw Error('isolated SDK transport unavailable');
  return {api};
 },error=>({error})).catch(error=>({error}));
 const point=(method,args)=>readiness.then(({api,error})=>{if(error)throw error;return api[method](...args)});
 return Object.freeze({synthetic:true,readFirst:(...args)=>point('readFirst',args),readDelta:(...args)=>point('readDelta',args),
 watch(next,fail){
  let active=true,stop;
  const nextIfActive=value=>{if(active)next(value)};
  const failIfActive=error=>{if(active)fail(error)};
  void readiness.then(({api,error})=>{
   if(!active)return;
   if(error){failIfActive(error);return;}
   try{
    const end=api.watch(nextIfActive,failIfActive);
    if(active)stop=end;else end?.();
   }catch(error){failIfActive(error);}
  });
  return ()=>{if(!active)return;active=false;stop?.();stop=undefined;};
 }});
}
function browserBoot({mode,app,sdkBase,project,source,first}){
 if(location.origin!==app||location.pathname!=='/'||location.search!=='?r2full='+mode)return;
 const counts={r1:0,watch:0,first:0,delta:0,stops:0,hold:{},waiting:{},release:{},error:null,r1Fallback:false,trace:[]};
 window.r2FullFixture=counts;
 const r1=()=>({ok:true,items:mode==='summary'&&!counts.r1Fallback?[]:[first],fromCache:false,hasPendingWrites:false,requiresLifecycleReconcile:false});
 window.cloudSync={
  isEnabled:()=>true,connect:async()=>true,
  subscribePublicTournaments(cb){counts.r1++;counts.trace.push('R1-WATCH');let active=true;queueMicrotask(()=>{if(active)cb(r1());});return()=>{active=false;};},
  queryPublicTournaments:async()=>r1()
 };
 if(mode!=='summary')return;
 const boot=new Function('return ('+source+')')();
 window.BXH_ARENA_HOME_LAB_TRANSPORT=boot(async()=>{
  const [appApi,sdk]=await Promise.all([import(sdkBase+'firebase-app.js'),import(sdkBase+'firebase-firestore.js')]);
  const cfg={projectId:project,apiKey:'demo-no-real-key',appId:'demo-r2-full-shell'};
  const firebase=appApi.initializeApp(cfg,'r2-guest-full-shell');
  if(firebase.options.projectId!==project)throw Error('R2 incorrect browser demo project');
  const db=sdk.getFirestore(firebase);
  sdk.connectFirestoreEmulator(db,'127.0.0.1',8188);
  const refs=Object.fromEntries(['version','first','delta'].map(key=>[key,sdk.doc(db,'arenaHomeLab',key)]));
  const confirmed=s=>s.metadata.fromCache===false&&s.metadata.hasPendingWrites===false;
  const point=async(kind)=>{
   counts[kind]++;
   const snap=await sdk.getDocFromServer(refs[kind]);
   if(!confirmed(snap))throw Error('R2 point not confirmed');
   if(!snap.exists()){
    if(kind==='delta')return null;
    throw Error('R2 required point missing');
   }
   const value=snap.data();
   const which=value.version??value.to;
   if(counts.hold[kind]===which)
    return new Promise(done=>{counts.waiting[kind]=which;counts.release[kind]=()=>{delete counts.hold[kind];delete counts.waiting[kind];done(value);};});
   return value;
  };
  return {synthetic:true,readFirst:()=>point('first'),readDelta:()=>point('delta'),
   watch(next,fail){
    counts.watch++;
    const err=e=>{counts.error=String(e?.code??e);fail(e);};
    const off=sdk.onSnapshot(refs.version,{includeMetadataChanges:true},snap=>{
     if(!snap.exists()&&confirmed(snap)){err(Error('R2 version missing'));return;}
     next({...snap.data(),fromCache:snap.metadata.fromCache,hasPendingWrites:snap.metadata.hasPendingWrites});
    },err);
    return()=>{counts.stops++;counts.trace.push('R2-STOP');off();};
   }};
 });
}
function routeDecision(raw){
 const u=new URL(raw);
 if(u.origin===APP){
  if(u.pathname==='/')return ['overlay','index.html'];
  if(u.pathname==='/modules/cloud/cloud-runtime.js')return ['stub'];
  if(Object.hasOwn(HASH,u.pathname.slice(1)))return ['overlay',u.pathname.slice(1)];
  if(/^\/(?:[^/]+\/)*[^/]+\.(?:js|mjs|css|json|webmanifest|png|webp|gif|svg|jpe?g|ico|woff2?)$/i.test(u.pathname)
    && u.pathname.slice(1).split('/').every(x=>x&&!x.startsWith('.')) && !u.pathname.includes('%'))
   return ['asset',u.pathname.slice(1)];
 }
 if(u.href.startsWith(SDK)&&/^[a-z0-9-]+\.js$/i.test(u.href.slice(SDK.length))&&!u.pathname.includes('app-check'))return ['sdk'];
 if(u.origin===EMU && u.pathname.startsWith('/google.firestore.v1.Firestore/') &&
  /\/(?:Listen\/channel|BatchGetDocuments)$/.test(u.pathname))return ['firestore'];
 return ['deny'];
}
function mime(file){
 const dict={js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',html:'text/html',webmanifest:'application/manifest+json',
 png:'image/png',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',jpg:'image/jpeg',jpeg:'image/jpeg',ico:'image/x-icon',woff2:'font/woff2',woff:'font/woff'};
 return dict[file.split('.').at(-1).toLowerCase()]??'application/octet-stream';
}
async function open(browser,{git,overlay},mode,first){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();const seen={firestore:0,denied:0};
 await context.route('**/*',async route=>{
  const [kind,file]=routeDecision(route.request().url());
  if(kind==='sdk')return route.continue();
  if(kind==='firestore'&&mode==='summary'){seen.firestore++;return route.continue();}
  if(kind==='stub')return route.fulfill({contentType:'text/javascript',body:'/* Isolated fixture retains its synthetic R1 stub. */'});
  if(kind==='overlay')return route.fulfill({contentType:mime(file),body:overlay.get(file)});
  if(kind==='asset'){
   // All same-origin supporting assets come from the exact Git commit, not the workspace or site.
   try{return route.fulfill({contentType:mime(file),body:git('show',BASE+':'+file)});}
   catch{return route.fulfill({status:404,body:'Missing in pinned fixture'});}
  }
  seen.denied++;
  return route.abort('blockedbyclient');
 });
 await page.addInitScript(browserBoot,{mode,app:APP,sdkBase:SDK,project:PROJECT,source:makeBootTransport.toString(),first});
 await page.goto(APP+'/?r2full='+mode,{waitUntil:'domcontentloaded'});
 await page.locator('[data-action="select-role-guest"]').click();
 return {context,page,seen};
}
function encode(v){
 if(v===null)return {nullValue:null};if(typeof v==='string')return {stringValue:v};
 if(typeof v==='boolean')return {booleanValue:v};if(Number.isSafeInteger(v))return {integerValue:String(v)};
 if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
 if(v&&typeof v==='object')return {mapValue:{fields:fields(v)}};
 throw Error('Unsupported fixture field');
}
const fields=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));
const w=(name,data)=>({update:{name:DOCS+'/'+name,fields:fields(data)}});
const d=name=>({delete:DOCS+'/'+name});
async function seed(request,writes){
 const r=await request.post(EMU+'/v1/'+DOCS+':commit',{headers:{Authorization:'Bearer owner'},maxRedirects:0,data:{writes}});
 expect(r.status(),'writes limited to dedicated synthetic emulator').toBe(200);
}
const card=(id,title)=>({id,title,eventDate:'2099-11-23',startAt:'19:00',location:'台南',authority:'official',
 eventPhase:'waiting',registrationStatus:'open',registrationEnabled:true,capacity:8,confirmedCount:2,publishedAt:1});
const source=(id,name,visibility='public')=>({id,code:id,name,visibility,eventAuthority:'official',eventDate:'2099-11-23',
 startAt:'19:00',tournamentPhase:'waiting',registrationStatus:'open',registrationEnabled:true,publishedAt:1,capacity:8,confirmedCount:2});
const first=(version,cards)=>w('arenaHomeLab/first',{version,cards});
const signal=(version,previous)=>w('arenaHomeLab/version',{version,previous});
const delta=(from,to)=>w('arenaHomeLab/delta',{from,to,upsert:[card(A,'late old update')],remove:[],order:[A,B]});
const counters=p=>p.evaluate(()=>{const {r1,watch,first,delta,error,waiting}=window.r2FullFixture;return {r1,watch,first,delta,error,waiting};});
for(const change of ['private','delete'])test('R2 exact #860 guest + Firestore demo SDK revocation: '+change, async ({browser,request})=>{
 const fx=fixture();
 await seed(request,[first(1,[card(A,'withdrawable event'),card(B,'unrelated event')]),signal(1,null),d('arenaHomeLab/delta'),
  w('publicTournaments/'+A,source(A,'withdrawable event')),w('publicTournaments/'+B,source(B,'unrelated event'))]);
 const {context,page,seen}=await open(browser,fx,'summary',source(B,'independent R1'));
 try{
  await expect(page.locator('[data-home-summary-fixture][data-lobby-code="'+A+'"]')).toBeAttached();
  await expect(page.locator('[data-home-summary-fixture][data-lobby-code="'+B+'"]')).toBeAttached();
  expect(seen.firestore).toBeGreaterThan(0);
  expect(await counters(page)).toMatchObject({r1:0,watch:1,first:1,delta:0,error:null});
  await page.evaluate(()=>{window.r2FullFixture.hold={delta:2,first:3};});
  await seed(request,[first(2,[card(A,'late old update'),card(B,'unrelated event')]),signal(2,1),delta(1,2)]);
  await expect.poll(async()=>(await counters(page)).waiting.delta).toBe(2);
  await page.evaluate(()=>{window.r2FullFixture.priorCycle=homeSummaryLab.settled();});
  await seed(request,[change==='private'?w('publicTournaments/'+A,source(A,'withdrawn event','private')):d('publicTournaments/'+A),
   first(3,[card(B,'unrelated event')]),signal(3,null),d('arenaHomeLab/delta')]);
  await expect.poll(async()=>(await counters(page)).waiting.first).toBe(3);
  await expect(page.locator('[data-lobby-code="'+A+'"]')).toHaveCount(0);
  await page.evaluate(async()=>{window.r2FullFixture.release.delta();await window.r2FullFixture.priorCycle;});
  await expect(page.locator('[data-lobby-code="'+A+'"]')).toHaveCount(0);
  await page.evaluate(()=>window.r2FullFixture.release.first());
  await expect(page.locator('[data-home-summary-fixture][data-lobby-code="'+B+'"]')).toBeAttached();
  await expect(page.locator('[data-lobby-code="'+A+'"]')).toHaveCount(0);
  expect(await counters(page)).toMatchObject({r1:0,watch:1,first:2,delta:1,error:null});
 }finally{await context.close();}
 const old=await open(browser,fx,'baseline',source(B,'independent R1'));
 try{
  await expect(old.page.locator('[data-lobby-code="'+B+'"]')).toBeAttached();
  await expect(old.page.locator('[data-home-summary-fixture]')).toHaveCount(0);
  expect(old.seen.firestore).toBe(0);
  expect((await counters(old.page)).r1).toBeGreaterThan(0);
 }finally{await old.context.close();}
});
// Keep the original #860 guest document open while turning the fixture off.
test('R2 exact #860 guest same-tab rollback drops a delayed Web SDK reply', async ({browser,request})=>{
 const fx=fixture();
 const legacyId='BXH-LAB-R1-CONTROL';
 await seed(request,[first(1,[card(A,'R2 before rollback'),card(B,'R2 control')]),signal(1,null),d('arenaHomeLab/delta'),
  w('publicTournaments/'+A,source(A,'R2 before rollback')),w('publicTournaments/'+B,source(B,'R2 control'))]);
 const {context,page,seen}=await open(browser,fx,'summary',source(legacyId,'Refreshed R1 after rollback'));
 try{
  const openedUrl=page.url();
  const r2=page.locator('[data-lobby-root] [data-home-summary-fixture]');
  const legacy=page.locator('[data-lobby-code="'+legacyId+'"]');
  await expect(r2).toHaveCount(2);
  await expect(legacy).toHaveCount(0);
  expect(await counters(page)).toMatchObject({r1:0,watch:1,first:1,delta:0,error:null});

  await page.evaluate(()=>{window.r2FullFixture.hold={delta:2};});
  await seed(request,[first(2,[card(A,'late old update'),card(B,'R2 control')]),signal(2,1),delta(1,2)]);
  await expect.poll(async()=>(await counters(page)).waiting.delta).toBe(2);
  const before=await page.evaluate(()=>{
   const f=window.r2FullFixture;
   f.priorCycle=homeSummaryLab.settled();
   f.sameDocument=document;
   f.r1Fallback=true;
   delete window.BXH_ARENA_HOME_LAB_TRANSPORT;
   syncPublicTournamentsRealtimeState();
   return {sameDocument:document===f.sameDocument, trace:[...f.trace], stops:f.stops, cards:homeSummaryLab.snapshot().cards};
  });
  expect(before).toMatchObject({sameDocument:true,trace:['R2-STOP','R1-WATCH'],stops:1,cards:null});
  await expect(legacy).toBeAttached();
  await expect(r2).toHaveCount(0);

  await page.evaluate(async()=>{window.r2FullFixture.release.delta();await window.r2FullFixture.priorCycle;});
  await expect(legacy).toBeAttached();
  await expect(r2).toHaveCount(0);
  expect(await counters(page)).toMatchObject({r1:1,watch:1,first:1,delta:1,error:null});
  expect(await page.evaluate(()=>({sameDocument:document===window.r2FullFixture.sameDocument,
    stops:window.r2FullFixture.stops,trace:window.r2FullFixture.trace,ids:lobbyBoundaryItems().map(x=>x.code)})))
   .toEqual({sameDocument:true,stops:1,trace:['R2-STOP','R1-WATCH'],ids:[legacyId]});
  expect(page.url()).toBe(openedUrl);
  expect(seen.firestore).toBeGreaterThan(0);  // Real demo Web SDK used before the switch.
 }finally{await context.close();}
});

module.exports={routeDecision,fixture};
