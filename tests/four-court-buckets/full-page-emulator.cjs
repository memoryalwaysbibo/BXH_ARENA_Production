'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const adapter=require('./full-page-source.cjs');
assert.equal(process.env.GCLOUD_PROJECT,adapter.project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
const {chromium}=require('playwright'),esbuild=require('esbuild'),{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
const B=require('../../referee-seats/functions/bucket-state.cjs'),{fixture}=require('./trusted-fixture.cjs');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'test-results/four-court-buckets/full-page');fs.mkdirSync(out,{recursive:true});
const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8'),adapted=adapter.build(cloud);
assert(cloud.includes('const FOUR_COURT_CLIENT_ROLLOUT = false;'));
const sdk=esbuild.buildSync({stdin:{contents:['app','auth','firestore','functions','app-check'].map(name=>`export * from 'firebase/${name}';`).join('\n'),resolveDir:root},bundle:true,write:false,format:'iife',globalName:'BXHFullPageSDK',platform:'browser',nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean)}).outputFiles[0].text;
const app=initializeApp({projectId:adapter.project},'bucket-full-page'),db=getFirestore(app),auth=getAuth(app),missing=new Set();
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/__bucket-page-sdk.js'){res.setHeader('Content-Type','text/javascript');res.end(sdk+'\n'+adapter.boot);return;}
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
 if(!file.startsWith(root+path.sep)||pathname.split('/').some(p=>p.startsWith('.'))||!['.html','.js','.css','.json','.png','.svg','.jpg','.webp','.ico','.woff2','.webmanifest'].includes(path.extname(file))){res.writeHead(404);res.end();return;}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){missing.add(pathname);res.writeHead(404);res.end();return;}
 let bytes=fs.readFileSync(file);if(file===path.join(root,'index.html'))bytes=bytes.toString().replace('<head>','<head><script src="/__bucket-page-sdk.js"></script>');
 if(file===path.join(root,'modules/cloud/cloud-runtime.js'))bytes=adapted;
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
});
(async()=>{
 let browser,page;const report={kind:'bucket-full-arena-page',productionWrites:0,sourceRolloutEnabled:false,realIndex:true,realCore:true,realAuth:true,nativeCallable:true,appCheck:'Emulator protocol fixture only',cases:[]};
 try{
  await auth.createUser({uid:'ref1',email:'ref1@full-page.invalid',password:'Emulator-only-pass-2026'});
  await db.doc('users/ref1').set({active:true,role:'staff',realName:'完整頁裁判',displayName:'完整頁裁判',email:'ref1@full-page.invalid'});
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,privateReadsEnabled:true});await db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const count of [6,12]){
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];page=await context.newPage();page.setDefaultTimeout(20000);
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto('http://127.0.0.1:'+server.address().port+'/');
   await page.waitForFunction(()=>window.cloudAuth?.isReady()&&typeof defaultState==='function'&&typeof processAuthStateChange==='function');
   const code=count===6?'BXH-PAGE06':'BXH-PAGE12',f=fixture(code,count,false),defaults=await page.evaluate(id=>defaultState(id),f.state.id);
   f.state={...defaults,...f.state,meta:{...defaults.meta,...f.state.meta,name:'完整頁分桶 '+count+' 台'},courtAssignments:Object.fromEntries(f.state.matches.map(m=>['court'+m.station,{currentMatchId:m.id,nextMatchId:null,status:'in_progress'}]))};
   f.room.data=JSON.stringify(f.state);await db.doc('tournaments/'+code).set(f.room);await db.doc('publicTournaments/'+code).set({bracketView:JSON.stringify(f.state),updatedAt:1});for(const bucket of B.encode(f.state,f.room.scoreStorage))await db.doc('tournaments/'+code+'/matchBuckets/'+bucket.bucketId).set(bucket);
   // Invoke the real Auth entry, not a fabricated UI role or identity. The
   // entire app's existing onAuthStateChanged/profile flow performs routing.
   assert.equal((await page.evaluate(()=>cloudAuth.signIn('ref1@full-page.invalid','Emulator-only-pass-2026'))).ok,true);
   await page.waitForFunction(()=>currentAuthUid()==='ref1'&&currentRole==='admin'&&userProfile?.role==='staff'&&appPhase==='app');
   assert.equal((await page.evaluate(code=>resolveAndJoinTournamentByCode(code,{forcePrivate:true}),code)).ok,true);
   await page.waitForFunction(count=>state.matches.length===count&&cloudSync.bucketView(state.cloudCode)?.status==='ready',count);
   await page.locator('[data-action="switch-tab"][data-tab="referee"]').first().click();
   const button=page.locator('[data-action="score"][data-id="m1"][data-side="A"][data-type="spin"]');await button.waitFor();assert.equal(await button.isEnabled(),true);
   assert.equal(await page.locator('.court-card.referee-workstation').count(),count);
   const rootBefore=await db.doc('tournaments/'+code).get(),pubBefore=await db.doc('publicTournaments/'+code).get();
   await button.click();await page.waitForFunction(()=>state.matches.find(m=>m.id==='m1').scoreA===1&&cloudSync.bucketView(state.cloudCode)?.pending.length===0);
   await page.evaluate(()=>window.dropNextBucketReply=true);await button.click();
   await page.waitForFunction(()=>state.matches.find(m=>m.id==='m1').scoreA===2&&cloudSync.bucketView(state.cloudCode)?.retryable.length===1);
   const navigation=page.url();await page.locator('[data-action="referee-sync-recovery"]').click();
   await page.waitForFunction(()=>cloudSync.bucketView(state.cloudCode)?.status==='ready'&&cloudSync.bucketView(state.cloudCode)?.retryable.length===1);
   await page.locator('[data-action="referee-bucket-retry"]').click();await page.waitForFunction(()=>cloudSync.bucketView(state.cloudCode)?.pending.length===0);
   assert.equal(page.url(),navigation);assert.equal(await page.locator('[data-action="referee-bucket-retry"]').count(),0);
   const wire=await page.evaluate(()=>BXHFullPageLab.wire.filter(w=>w.name==='commitBucketRefereeCommand'));
   assert.equal(wire.length,3);assert.deepEqual(wire[1],wire[2]);assert.equal(await page.locator('#court-card-1 .side-score').first().innerText(),'2');assert.equal(await page.evaluate(()=>state.matches.find(m=>m.id==='m1').scoreA),2);
   const scored=JSON.parse((await db.doc('tournaments/'+code+'/matchBuckets/court-1').get()).data().matches).find(m=>m.id==='m1');assert.equal(scored.scoreA,2);assert.equal(scored.log.length,2);
   assert((await db.doc('tournaments/'+code).get()).updateTime.isEqual(rootBefore.updateTime),'ordinary scoring rewrote root');assert((await db.doc('publicTournaments/'+code).get()).updateTime.isEqual(pubBefore.updateTime),'ordinary scoring rewrote public mirror');
   assert.equal(await page.evaluate(()=>BXHFullPageLab.wire.filter(w=>['commitRefereeCommand','manageRefereeSeats'].includes(w.name)).length),0);
   await page.screenshot({path:path.join(out,count+'-courts-mobile.png'),fullPage:true});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(out,count+'-courts-desktop.png'),fullPage:true});
   await db.doc('users/ref1').update({active:false});await page.waitForFunction(()=>cloudStatus==='error'&&state.matches.length===0);assert.equal(await page.locator('[data-action="score"]').count(),0);await db.doc('users/ref1').update({active:true});
   assert.deepEqual(errors,[],'uncaught full-page errors');report.cases.push({courts:count,buckets:Math.ceil(count/4),fullPageBoot:true,realAuthRouting:true,composedJoin:true,realScoreButton:true,reconnectButton:true,sameOperationRetryButton:true,noDuplicateScore:true,rootAndPublicUnchanged:true,legacyCallableCalls:0,revocationClearsPage:true,uncaughtPageErrors:0});await context.close();page=null;
  }
  assert.deepEqual([...missing].filter(p=>/\.(js|css)$/.test(p)),[],'full page required asset missing');report.missingLocalAssets=[...missing];fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS full ARENA page: '+JSON.stringify(report));
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});const diagnostic={message:error.message,missing:[...missing],page:await page.evaluate(()=>({text:document.body.innerText.slice(-6000),phase:typeof appPhase==='undefined'?null:appPhase,role:typeof currentRole==='undefined'?null:currentRole})).catch(()=>null)};fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify(diagnostic,null,2));console.error('full-page diagnostic '+JSON.stringify(diagnostic));}throw error;}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
