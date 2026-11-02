'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
const {chromium}=require('playwright'),{initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const B=require('../../referee-seats/functions/bucket-state.cjs'),C=require('../../referee-seats/functions/core.cjs');
const {createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{createBucketSeatHandler}=require('../../referee-seats/functions/bucket-seat-service.cjs');
const {fixture,request}=require('./trusted-fixture.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'bucket-browser'),db=getFirestore(app),commit=createBucketScoringHandler(db),seat=createBucketSeatHandler(db);
const rootPath=path.resolve(__dirname,'../..'),code='BXH-BROWSER6',root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),stops=new Set();
const assets={
 '/lab/index.html':['text/html',fs.readFileSync(path.join(__dirname,'referee-fixture.html'),'utf8')],
 '/lab/buckets.js':['text/javascript','(function(){const module={exports:{}};'+fs.readFileSync(path.join(rootPath,'referee-seats/functions/bucket-state.cjs'),'utf8')+';window.BXHMatchBuckets=module.exports;})();'],
 '/lab/client.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/scoring/four-court-client.cjs'),'utf8')],
 '/lab/page.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/scoring/four-court-referee-lab.js'),'utf8')],
 '/lab/seats.js':['text/javascript',fs.readFileSync(path.join(rootPath,'modules/main-app/referee-seats.js'),'utf8')],
 '/lab/seats.css':['text/css',fs.readFileSync(path.join(rootPath,'modules/main-app/referee-seats.css'),'utf8')]
};
const server=http.createServer((req,res)=>{const asset=assets[req.url];if(!asset){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',asset[0]);res.end(asset[1]);});
async function read(){const room=(await root.get()).data(),base=JSON.parse(room.data),m=B.context(room,base),snaps=await root.collection('matchBuckets').get();return {room,state:B.materialize(base,m,snaps.docs.map(s=>s.data()))};}
(async()=>{
 let browser;
 try{
  const f=fixture(code,6,false);f.room.refereeSeatsV1={...f.room.refereeSeatsV1,revision:0,requests:{}};
  await root.set(f.room);await pub.set({bracketView:JSON.stringify(f.state),updatedAt:1});
  for(const bucket of B.encode(f.state,f.room.scoreStorage))await root.collection('matchBuckets').doc(bucket.bucketId).set(bucket);
  for(const uid of ['ref1','ref5','relief'])await db.doc('users/'+uid).set({...f.user,realName:uid==='relief'?'交接裁判':uid});
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true});await db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  async function client(uid){
   const page=await browser.newPage({viewport:{width:390,height:844}}),subscriptions=new Map();
   await page.exposeFunction('labWatch',async({key,kind,id})=>{
    // Test bridge only: fixed identity, exact demo DB, no exported service.
    const [room,user]=await Promise.all([root.get(),db.doc('users/'+uid).get()]);
    if(!C.eligible(room.data(),user.data(),uid))throw Error('not-event-staff');
    const ref=kind==='room'?root:root.collection('matchBuckets').doc(id);
    const stop=ref.onSnapshot(snap=>{
     const event=kind==='room'?{room:snap.data(),version:(BigInt(snap.updateTime.seconds)*1000000000n+BigInt(snap.updateTime.nanoseconds)).toString()}:{bucket:snap.exists?snap.data():null};
     page.evaluate(({key,event})=>window.labReceive?.(key,event),{key,event}).catch(()=>{});
    },()=>page.evaluate(key=>window.labFailure?.(key),key).catch(()=>{}));
    subscriptions.set(key,stop);stops.add(stop);
   });
   await page.exposeFunction('labStop',key=>{const stop=subscriptions.get(key);if(stop){stop();stops.delete(stop);subscriptions.delete(key);}});
   await page.exposeFunction('labCommand',async({type,data,drop})=>{let result;try{result=await(type==='score'?commit:seat)({auth:{uid},data});}catch(error){return {ok:false,reason:error.message};}if(drop)throw Error('simulated-lost-reply');return result;});
   await page.goto('http://127.0.0.1:'+server.address().port+'/lab/index.html');
   await page.evaluate(({code,uid})=>{
    const callbacks=new Map();let serial=0;
    window.labReceive=(key,event)=>callbacks.get(key)?.next(event);window.labFailure=key=>callbacks.get(key)?.error();
    const watch=(kind,id,next,error)=>{const key=String(++serial);callbacks.set(key,{next,error});window.labWatch({key,kind,id}).catch(error);return ()=>{callbacks.delete(key);window.labStop(key);};};
    const transport={projectId:'demo-bxh-four-court-buckets',watchRoom:(_code,next,error)=>watch('room',null,next,error),watchBucket:(_code,id,next,error)=>watch('bucket',id,next,error),manageSeats:data=>window.labCommand({type:'seat',data}),commitScore:data=>{const drop=window.dropNextReply===true;window.dropNextReply=false;return window.labCommand({type:'score',data,drop});}};
    window.testTransport=transport;
   },{code,uid});
   await page.evaluate(({code,uid})=>{window.panel=BXHFourCourtLab.mount(document.getElementById('referee'),{transport:window.testTransport,code,uid});},{code,uid});
   return page;
  }
  const main=await client('ref1'),relief=await client('relief');
  await main.waitForFunction(()=>panel.client.getView().status==='ready');await relief.waitForFunction(()=>panel.client.getView().status==='ready');
  await main.locator('.lab-a').click();await main.waitForFunction(()=>document.querySelector('.lab-score').textContent==='1：0');
  await relief.locator('[data-slot="backup1"]').click();await relief.waitForFunction(()=>panel.client.getView().state.meta.refereeSeatsV1.courts['1'].backup1?.uid==='relief');
  await relief.locator('[data-slot="main"]').click();await relief.getByRole('button',{name:'提出權限交接',exact:true}).click();
  await main.getByRole('dialog').getByRole('button',{name:'確定',exact:true}).click();
  await relief.waitForFunction(()=>panel.client.getView().state.meta.refereeSeatsV1.courts['1'].main?.uid==='relief');
  assert.equal(await relief.locator('.lab-score').innerText(),'1：0');
  await relief.locator('.lab-a').click();await relief.waitForFunction(()=>document.querySelector('.lab-score').textContent==='2：0');
  await relief.locator('[data-slot="backup1"]').click();await relief.getByRole('button',{name:'撤銷此席位',exact:true}).click();await relief.getByRole('dialog').getByRole('button',{name:'確定',exact:true}).click();
  await main.waitForFunction(()=>!panel.client.canScore(1));assert(await main.locator('.lab-a').isDisabled());
  await relief.locator('.lab-connection').click();assert(await relief.locator('.lab-a').isDisabled());
  const current=await read(),d=request(current.state,current.room,'m5','score','browser-external-operation-1',{side:'B',finish:'burst'});await commit({auth:{uid:'ref5'},data:d});
  await relief.locator('.lab-connection').click();await relief.waitForFunction(()=>panel.client.getView().status==='ready');
  await relief.locator('.lab-court').selectOption('5');await relief.waitForFunction(()=>document.querySelector('.lab-score').textContent==='0：2');
  await relief.locator('.lab-court').selectOption('1');await relief.evaluate(()=>window.dropNextReply=true);await relief.locator('.lab-a').click();
  await relief.waitForFunction(()=>document.querySelector('.lab-score').textContent==='3：0');await relief.locator('.lab-retry').waitFor();await relief.locator('.lab-retry').click();await relief.waitForFunction(()=>panel.client.getView().pending.length===0);
  const latest=await read();assert.equal(latest.state.matches[0].scoreA,3);assert.equal(latest.state.matches[0].log.length,3);
  for(const width of [390,960]){await relief.setViewportSize({width,height:900});assert(await relief.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const dir=path.join(rootPath,'test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});await relief.screenshot({path:path.join(dir,'referee-client-'+width+'.png')});}
  console.log('PASS browser bucket referee: '+JSON.stringify({productionWrites:0,bridge:'Admin SDK Emulator test only',scoreAndHandover:true,revocation:true,reconnect:true,lostReplyDeduplicated:true}));
 }finally{for(const stop of stops)stop();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
