'use strict';
const {test,expect}=require('@playwright/test');
const {readFileSync}=require('node:fs');
const {setTimeout:sleep}=require('node:timers/promises');
const {projectPinnedCard}=require('../public-card-projection.cjs');
const {buildHomePublication}=require('../../../arena-home-lab/home-publisher.cjs');
const {attachBodyMeter}=require('./wire.cjs');
const project='demo-bxh-arena-r2-websdk';
const host='127.0.0.1:8188', origin='http://'+host, appOrigin='http://127.0.0.1:4173';
const docs='projects/'+project+'/databases/(default)/documents';
const labBranch='lab/r2-home-websdk-reconnect-20261122';
const controller=readFileSync(__dirname+'/../../candidate/modules/main-app/home-summary-lab.js','utf8');
const pageScript=readFileSync(__dirname+'/browser-side.mjs','utf8');
const html='<!doctype html><meta charset="utf-8"><title>BXH isolated R2 transport</title><ul></ul><script src="./controller.js"></script><script type="module" src="./browser.js"></script>';
function scope(){
 const p=process.env;
 if(p.GCLOUD_PROJECT!==project||p.FIRESTORE_EMULATOR_HOST!==host)throw Error('wrong-demo-project-or-host');
 if(p.GITHUB_ACTIONS==='true'&&!(
  p.GITHUB_EVENT_NAME==='pull_request'&&p.GITHUB_BASE_REF==='main'&&p.GITHUB_HEAD_REF===labBranch||
  p.GITHUB_EVENT_NAME==='workflow_dispatch'&&p.GITHUB_REF==='refs/heads/'+labBranch
 ))throw Error('wrong-lab-ci-branch');
}
const sdk='https://www.gstatic.com/firebasejs/10.13.0/';
async function open(browser,mode){
 const browserContext=await browser.newContext({serviceWorkers:'block'});
 const blocked=[];
 await browserContext.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin===appOrigin){
   if(u.pathname==='/r2-isolated/')return route.fulfill({status:200,contentType:'text/html',body:html});
   if(u.pathname==='/r2-isolated/controller.js')return route.fulfill({status:200,contentType:'text/javascript',body:controller});
   if(u.pathname==='/r2-isolated/browser.js')return route.fulfill({status:200,contentType:'text/javascript',body:pageScript});
  }
  if(u.origin===origin||u.href.startsWith(sdk)&&!u.pathname.includes('app-check'))return route.continue();
  blocked.push(u.origin);return route.abort('blockedbyclient');
 });
 const page=await browserContext.newPage();
 const meter=await attachBodyMeter(browserContext,page);
 const errors=[];page.on('pageerror',e=>errors.push(e.name));
 await page.goto(appOrigin+'/r2-isolated/?mode='+mode);
 await page.waitForFunction(()=>window.r2?.ready===true);
 return {browserContext,page,meter,blocked,errors};
}
function encode(x){
 if(x===null)return {nullValue:null};
 if(typeof x==='string')return {stringValue:x};
 if(typeof x==='boolean')return {booleanValue:x};
 if(Number.isSafeInteger(x))return {integerValue:String(x)};
 if(Array.isArray(x))return {arrayValue:{values:x.map(encode)}};
 if(x&&typeof x==='object')return {mapValue:{fields:fields(x)}};
 throw Error('bad-synthetic-field');
}
function fields(x){return Object.fromEntries(Object.entries(x).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encode(v)]));}
const write=(path,value)=>({update:{name:docs+'/'+path,fields:fields(value)}});
async function commit(request,writes){
 const r=await request.post(origin+'/v1/'+docs+':commit',{headers:{Authorization:'Bearer owner'},maxRedirects:0,data:{writes}});
 expect(r.status(),'only isolated emulator fixture writes').toBe(200);
}
const n=20, rosterSize=128, ids=Array.from({length:n},(_,i)=>'BXH-R2-'+String(i).padStart(2,'0'));
function fixtures(){
 const now=Date.now();
 return new Map(ids.map((id,i)=>{
  const players=Array.from({length:rosterSize},(_,j)=>({id:id+'-P'+j,name:'Synthetic participant '+i+'-'+j,checkedIn:j%3===0}));
  const matches=Array.from({length:rosterSize-1},(_,j)=>({id:id+'-M'+j,a:{playerId:players[j].id},b:{playerId:players[j+1].id},
   completed:false,isBye:false,scoreA:0,scoreB:0}));
  return [id,{visibility:'public',eventAuthority:'official',name:'Synthetic tournament '+i,hostName:'Synthetic organizer',publishedAt:now,
    eventDate:'2026-11-22',startAt:'13:00',registrationEnabled:true,registrationVisibility:'public',
    registrationOpenAt:now-3600000,registrationCloseAt:now+3600000,tournamentPhase:'waiting',registrationStatus:'open',
    capacity:320,confirmedCount:rosterSize,bracketView:JSON.stringify({meta:{name:'Synthetic tournament '+i},players,matches,archiveStatus:'ongoing'})}];
 }));
}
function publication(previous,rooms){
 const cards=Array.from(rooms,([id,value])=>{
  const p=projectPinnedCard(id,value);
  if(p.status!=='ready')throw Error('synthetic-projection-'+p.status);
  return {...p.card,visibility:'public'};
 });
 return buildHomePublication(previous,cards,{categoryAwarePreview:true});
}
function publicationWrites(pub){
 const docs=[write('arenaHomeLab/first',pub.first),write('arenaHomeLab/version',pub.signal)];
 if(pub.delta)docs.push(write('arenaHomeLab/delta',pub.delta));
 return docs;
}
async function ready(entry,ver,count){
 await entry.page.waitForFunction(({ver,id,count,size})=>window.r2?.version===ver&&window.r2.ids.length===size&&
  window.r2.counts?.[id]===count&&document.getElementById(id)?.textContent===id+': '+count,
 {ver,id:ids[0],count,size:n});
 return entry.page.evaluate(()=>({
  count:Object.keys(window.r2.counts).length,counts:window.r2.counts,first:window.r2.first,delta:window.r2.delta,watch:window.r2.watch,error:window.r2.error
 }));
}
const networkState=x=>x.page.evaluate(()=>({
 freshness:window.r2.freshness,counts:window.r2.counts,error:window.r2.error,
 first:window.r2.first,delta:window.r2.delta,watch:window.r2.watch,...window.r2.counters
}));
function counterDelta(before,after){
 const keys=['first','delta','watch','cacheSnapshots','serverSnapshots','queryDocumentsInServerViews','queryDocumentChanges',
  'versionDocumentsInServerViews','versionValueChanges','trustedPointDocuments','confirmedRenderEvents'];
 return Object.fromEntries(keys.map(k=>[k,after[k]-before[k]]));
}
async function reconnectPhase(browser,a,b,v,count){
 const [warmA,warmB]=await Promise.all([open(browser,'baseline'),open(browser,'summary')]);
 const all=[a,b,warmA,warmB], recovering=[a,b];
 try{
  await Promise.all([warmA,warmB].map(x=>x.page.evaluate(()=>globalThis.r2Start())));
  await Promise.all([ready(a,'server',count),ready(warmA,'server',count),ready(b,v,count),ready(warmB,v,count)]);
  await expect.poll(()=>all.map(x=>x.meter.listenState().responded>0)).toEqual([true,true,true,true]);
  const before=await Promise.all(all.map(networkState));
  expect(before.map(x=>x.freshness)).toEqual(['server','server','server','server']);
  expect(before[0].counts).toEqual(before[2].counts);
  expect(before[1].counts).toEqual(before[3].counts);
  all.forEach(x=>x.meter.begin());
  await Promise.all(recovering.map(x=>x.page.evaluate(()=>globalThis.r2Network(false))));
  await expect.poll(()=>recovering.map(x=>x.meter.listenState().active)).toEqual([0,0]);
  await expect.poll(async()=> (await Promise.all(recovering.map(networkState))).map(x=>x.freshness)).toEqual(['cache','unknown']);
  const detached=recovering.map(x=>x.meter.listenState());
  await sleep(750);
  expect(recovering.map(x=>x.meter.listenState())).toEqual(detached); // actual no-transport gap
  expect((await Promise.all([warmA,warmB].map(networkState))).map(x=>x.freshness)).toEqual(['server','server']);
  await Promise.all(recovering.map(x=>x.page.evaluate(()=>globalThis.r2Network(true))));
  await expect.poll(()=>recovering.map((x,i)=>x.meter.listenState().responded>detached[i].responded)).toEqual([true,true]);
  await expect.poll(async()=> (await Promise.all(recovering.map(networkState))).map((x,i)=>
    x.freshness==='server'&&x.serverSnapshots>before[i].serverSnapshots)).toEqual([true,true]);
  const end=await Promise.all(all.map(networkState));
  const wire=await Promise.all(all.map(x=>x.meter.end()));
  const delivered=end.map((x,i)=>counterDelta(before[i],x));
  for(let i=0;i<end.length;i++){
   expect(end[i].counts).toEqual(before[0].counts);
   expect(end[i].error).toBeNull();
   expect(end[i].freshness).toBe('server');
  }
  expect(delivered[1]).toMatchObject({first:0,delta:0,watch:0,versionValueChanges:0,trustedPointDocuments:0});
  expect(delivered[3]).toMatchObject({first:0,delta:0,watch:0,versionValueChanges:0,trustedPointDocuments:0});
  expect(delivered[0].queryDocumentChanges).toBe(0);
  expect(delivered[2].queryDocumentChanges).toBe(0);
  for(let i=0;i<2;i++)expect(Number.isSafeInteger(wire[i].firestoreResponseBodyBytes),'reattached real Listen body instrumentation').toBe(true);
  expect(all.map(x=>x.errors)).toEqual([[],[],[],[]]);
  return {arms:['baseline-reconnect','summary-reconnect','baseline-warm','summary-warm'],delivered,wire,
   provenNoTransportGapMs:750,sourceChangesDuringWindow:0,
   meaning:'SDK snapshots/docChanges and trusted point receipts are not wire DocumentChange counts or billed reads; a null quiet arm byte count is no positively measured body, not a guaranteed zero'};
 }finally{
  await Promise.allSettled([warmA,warmB].map(x=>x.browserContext.close()));
 }
}
test('R2 20-room cold, one-card update and paired reconnect pinned Web SDK transport',async ({browser,request})=>{
 scope();
 const rooms=fixtures(),p1=publication(null,rooms);
 expect(p1.first.cards.length).toBe(n);
 await commit(request,[...Array.from(rooms,([id,value])=>write('publicTournaments/'+id,value)),...publicationWrites(p1),
  write('arenaHomeLabPrivateCatalog/current',{sentinel:'synthetic-not-public'})]);
 const [a,b]=await Promise.all([open(browser,'baseline'),open(browser,'summary')]);
 try {
  a.meter.begin();b.meter.begin();
  await Promise.all([a,b].map(x=>x.page.evaluate(()=>globalThis.r2Start())));
  const start=await Promise.all([ready(a,'server',rosterSize),ready(b,p1.first.version,rosterSize)]);
  await sleep(500);
  const cold=await Promise.all([a.meter.end(),b.meter.end()]);
  expect(start[0].counts).toEqual(start[1].counts);
  expect(start[1]).toMatchObject({watch:1,first:1,delta:0,error:null});
  rooms.set(ids[0],{...rooms.get(ids[0]),confirmedCount:rosterSize+1});
  const p2=publication(p1.first,rooms);
  expect(p2.delta?.upsert.map(x=>x.id)).toEqual([ids[0]]);
  await Promise.all([a,b].map(x=>x.page.evaluate(id=>{globalThis.r2UnchangedNode=document.getElementById(id);},ids[1])));
  a.meter.begin();b.meter.begin();
  await commit(request,[write('publicTournaments/'+ids[0],rooms.get(ids[0])),...publicationWrites(p2)]);
  const after=await Promise.all([ready(a,'server',rosterSize+1),ready(b,p2.first.version,rosterSize+1)]);
  await sleep(500);
  const oneCard=await Promise.all([a.meter.end(),b.meter.end()]);
  expect(after[0].counts).toEqual(after[1].counts);
  expect(after[1]).toMatchObject({watch:1,first:1,delta:1,error:null});
  for(const x of [a,b]){
   expect(await x.page.evaluate(id=>globalThis.r2UnchangedNode===document.getElementById(id),ids[1])).toBe(true);
   expect(x.errors).toEqual([]);
   expect(x.blocked).not.toContain('https://firestore.googleapis.com');
   expect(await x.page.evaluate(()=>globalThis.r2ProbePrivate())).toBe('permission-denied');
  }
  console.log(JSON.stringify({status:'both-rendered',shape:{rooms:n,rosterPerRoom:rosterSize},
   cold:{baseline:cold[0],summary:cold[1]},oneCard:{baseline:oneCard[0],summary:oneCard[1]},
   first:1,delta:1,knownStableNode:true,
   scope:'synthetic guest harness, same released full Watch query shape vs existing R2 controller; not full Arena UI, real traffic or billing'}));
  for(const phase of [cold,oneCard]){
   expect(phase.every(x=>Number.isSafeInteger(x.firestoreResponseBodyBytes)),'missing meter data is not zero').toBe(true);
   expect(phase[1].firestoreResponseBodyBytes,'summary body must be smaller in this anchored fixture').toBeLessThan(phase[0].firestoreResponseBodyBytes);
  }
  const reconnect=await reconnectPhase(browser,a,b,p2.first.version,rosterSize+1);
  console.log(JSON.stringify({status:'reconnect-paired',...reconnect}));
 }finally{
  await Promise.allSettled([a,b].map(x=>x.browserContext.close()));
 }
});
