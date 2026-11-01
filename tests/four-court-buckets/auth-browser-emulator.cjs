'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const native=process.env.BUCKET_NATIVE_CALLABLES==='1';let httpCommands=0;
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
const {chromium}=require('playwright'),esbuild=require('esbuild'),{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
const {fixture}=require('./trusted-fixture.cjs'),B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{createBucketSeatHandler}=require('../../referee-seats/functions/bucket-seat-service.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'bucket-auth-browser'),db=getFirestore(app),auth=getAuth(app),commit=createBucketScoringHandler(db),seat=createBucketSeatHandler(db),rootPath=path.resolve(__dirname,'../..');
const sdk=esbuild.buildSync({stdin:{contents:"export {initializeApp} from 'firebase/app';export {getAuth,connectAuthEmulator,setPersistence,inMemoryPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged} from 'firebase/auth';export {getFirestore,connectFirestoreEmulator,doc,onSnapshot,getDocFromServer} from 'firebase/firestore';export {getFunctions,connectFunctionsEmulator,httpsCallable} from 'firebase/functions';export {initializeAppCheck,CustomProvider} from 'firebase/app-check';",resolveDir:rootPath},bundle:true,write:false,format:'iife',globalName:'BXHBrowserSDK',platform:'browser',nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean)}).outputFiles[0].text;
const core=fs.readFileSync(path.join(rootPath,'modules/main-app/core.js'),'utf8'),begin=core.indexOf('const refereeSeatCommandBusy='),end=core.indexOf('\n\nasync function executeRefereeDispatchCommand(',begin);assert(begin>=0&&end>begin);
const assets={
 '/auth/index.html':['text/html',fs.readFileSync(path.join(__dirname,'auth-fixture.html'),'utf8')],
 '/auth/sdk.js':['text/javascript',sdk],
 '/auth/buckets.js':['text/javascript','(function(){const module={exports:{}};'+fs.readFileSync(path.join(rootPath,'referee-seats/functions/bucket-state.cjs'),'utf8')+';window.BXHMatchBuckets=module.exports;})();'],
 '/auth/client.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/scoring/four-court-client.cjs'),'utf8')],
 '/auth/transport.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/scoring/four-court-firestore-transport.cjs'),'utf8')],
 '/auth/bridge.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/scoring/four-court-app-bridge.cjs'),'utf8')],
 '/auth/session.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/scoring/four-court-session.cjs'),'utf8')],
 '/auth/panel.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/scoring/four-court-referee-lab.js'),'utf8')],
 '/auth/seats.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/main-app/referee-seats.js'),'utf8')],
 '/auth/seats.css':['text/css',fs.readFileSync(path.join(rootPath,'modules/main-app/referee-seats.css'),'utf8')],
 '/auth/core-command.js':['text/javascript',core.slice(begin,end)],
 '/auth/boot.js':['text/javascript',fs.readFileSync(path.join(__dirname,'auth-fixture.js'),'utf8')]
};
const server=http.createServer(async(req,res)=>{
 if(req.url==='/auth/command'&&req.method==='POST'){
  httpCommands++;
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>20000)throw Error('request-too-large');}const decoded=await auth.verifyIdToken(String(req.headers.authorization||'').replace(/^Bearer /,'')),input=JSON.parse(body);if(!['BXH-AUTH6','BXH-AUTH12'].includes(input.data?.code)||!['score','seat'].includes(input.type))throw Error('invalid-lab-command');const result=await(input.type==='score'?commit:seat)({auth:{uid:decoded.uid},data:input.data});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,reason:error.message}));}return;
 }
 const url=new URL(req.url,'http://127.0.0.1'),asset=assets[url.pathname];if(!asset){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',asset[0]);res.end(asset[1]);
});
(async()=>{
 let browser;const report={kind:native?'bucket-native-callable-browser':'bucket-real-browser-auth',productionWrites:0,directBrowserReads:true,commandAdapter:native?'Firebase httpsCallable with Emulator App Check fixture':'local HTTP with verified Emulator ID token',cases:[]};
 try{
  for(const uid of ['ref1','ref5','player']){await auth.createUser({uid,email:uid+'@bucket.invalid',password:'Emulator-only-pass-2026'});await db.doc('users/'+uid).set({active:true,role:uid==='player'?'player':'staff',realName:uid});}
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,privateReadsEnabled:true});await db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true});
  for(const count of [6,12]){const code='BXH-AUTH'+count,f=fixture(code,count,false);f.room.refereeSeatsV1={...f.room.refereeSeatsV1,revision:0,requests:{}};await db.doc('tournaments/'+code).set(f.room);await db.doc('publicTournaments/'+code).set({bracketView:JSON.stringify(f.state),updatedAt:1});for(const bucket of B.encode(f.state,f.room.scoreStorage))await db.doc('tournaments/'+code+'/matchBuckets/'+bucket.bucketId).set(bucket);}
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  async function pageFor(count){const page=await browser.newPage({viewport:{width:390,height:844}});await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());await page.goto('http://127.0.0.1:'+server.address().port+'/auth/index.html?code=BXH-AUTH'+count+(native?'&callable=1':''));return page;}
  async function login(page,uid,expected='ready'){await page.locator('#account').selectOption(uid);await page.locator('#login').click();await page.waitForFunction(({uid,expected})=>document.getElementById('identity').textContent==='已登入：'+uid&&window.panel?.client.getView().status===expected,{uid,expected});}
  for(const count of [6,12]){
   const page=await pageFor(count);await login(page,'ref1');assert.equal(await page.evaluate(()=>panel.client.getView().state.matches.length),count);
   if(native){const ref=db.doc('tournaments/BXH-AUTH'+count+'/matchBuckets/court-1'),before=await ref.get(),denied=await page.evaluate(()=>testCallableChecks());assert.equal(denied.missingAppCheck,401);assert.equal(denied.missingAuth,401);assert((await ref.get()).updateTime.isEqual(before.updateTime));}
   await page.locator('.lab-a').click();await page.waitForFunction(()=>state.matches[0].scoreA===1&&panel.client.getView().pending.length===0);assert.equal(await page.evaluate(()=>legacyReads),0);
   await page.evaluate(()=>window.oldClient=panel.client);await login(page,'ref5');assert.equal(await page.evaluate(()=>oldClient.getView().state),null);assert(await page.locator('.lab-a').isDisabled());
   await page.locator('.lab-court').selectOption('5');await page.locator('.lab-b').click();await page.waitForFunction(()=>state.matches.find(m=>m.id==='m5').scoreB===1&&panel.client.getView().pending.length===0);
   await db.doc('users/ref5').update({active:false});await page.waitForFunction(()=>panel.client.getView().status==='error'&&panel.client.getView().state===null);assert.equal(await page.locator('.lab-score').innerText(),'等待賽事');assert.equal(await page.locator('.ref-seat-button').count(),0);
   const blocked=await pageFor(count);await login(blocked,'ref5','error');assert.equal(await blocked.evaluate(()=>panel.client.getView().state),null);await blocked.close();
   await db.doc('users/ref5').update({active:true});await login(page,'ref5');await page.evaluate(()=>window.logoutClient=panel.client);await page.locator('#logout').click();await page.waitForFunction(()=>document.getElementById('identity').textContent==='未登入');assert.equal(await page.evaluate(()=>logoutClient.getView().state),null);
   await login(page,'player','error');assert.equal(await page.evaluate(()=>panel.client.getView().state),null);assert.equal(await page.locator('.ref-seat-button').count(),0);
   if(native){const result=await page.evaluate(()=>testPlayerCallable());assert.equal(result.ok,false);assert.equal(result.code,'functions/permission-denied');assert.equal(result.reason,'station-not-assigned');}
   const bucket=(await db.doc('tournaments/BXH-AUTH'+count+'/matchBuckets/court-1').get()).data(),matches=JSON.parse(bucket.matches);assert.equal(matches[0].scoreA,1);assert.equal(matches[0].log.length,1);
   report.cases.push({courts:count,buckets:Math.ceil(count/4),emailPasswordAuth:true,existingCommandCore:true,accountSwitchClearsView:true,profileRevocationClearsView:true,revokedNewLoginDenied:true,signOutClearsView:true,playerReadDenied:true,legacyReadFallbacks:0,...(native?{missingAppCheckDenied:true,missingAuthDenied:true,playerCallableDenied:true,nativeCallable:true}:{})});await page.close();
  }
  if(native)assert.equal(httpCommands,0,'native Callable test used the legacy HTTP adapter');
  const dir=path.join(rootPath,'test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,native?'callable-browser.json':'auth-browser.json'),JSON.stringify(report,null,2)+'\n');console.log((native?'PASS native Callable browser: ':'PASS real browser Auth: ')+JSON.stringify(report));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
