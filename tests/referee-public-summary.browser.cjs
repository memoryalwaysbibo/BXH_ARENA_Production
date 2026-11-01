'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const {MockDB,user}=require('../referee-certificates/test/mock-db.cjs');
const {createPublicSummary}=require('../referee-certificates/functions/public-summary.cjs');
const db=new MockDB({'systemConfig/refereeCertificatesV1':{enabled:true,publicSummaryEnabled:true},'users/alice':user('player',{realName:'核定姓名',email:'SECRET_EMAIL',phone:'SECRET_PHONE'}),'refereeCertificates/alice':{number:'R000019',awardedLevel:1,qualificationStatus:'active',approvedBy:'SECRET_APPROVER',approvedAt:1,personId:'SECRET_PERSON',photoDataUrl:'SECRET_PHOTO'},'users/bob':user()});
const pub=createPublicSummary(db);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BXH_TEST_BROWSER,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
  await page.exposeFunction('getPublic',data=>pub({data}));await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px/1.5 sans-serif}</style></head><body><main></main></body></html>');
  await page.addStyleTag({content:'@font-face{font-family:FixtureKai;src:url(data:font/ttf;base64,'+fs.readFileSync('modules/referee-license/fonts/bxh-kai-subset.ttf').toString('base64')+') format("truetype")}body{font:16px/1.5 FixtureKai,sans-serif}'});
  await page.evaluate(()=>document.fonts.load('16px FixtureKai'));
  await page.evaluate(()=>{
   window.playerCardsUI={uid:'viewer',opened:false};window.currentAuthUid=()=> 'viewer';window.BXH_REFEREE_PUBLIC_SUMMARY_V1=true;
   window.esc=x=>String(x??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
   window.titleChipHtml=()=>'';window.ladderDisplayTier=()=>'';window.showToast=()=>{};window.managedFeatureError=()=> 'error';
   window.render=()=>BXHPlayerCardsFeature.renderPlayerCardOverlay();window.summaryCalls=[];window.expiry=[];
   const timer=window.setTimeout;window.setTimeout=(fn,ms)=>ms===30000?expiry.push(fn):timer(fn,ms);
   window.engagementService={playerCard:async data=>({ok:true,card:{uid:data.uid,name:'玩家名片',playerId:'P1'}}),refereePublicSummary:data=>{summaryCalls.push(data);return window.defer?new Promise(resolve=>window.resolveSummary=resolve):window.fail?Promise.reject(Error('offline')):getPublic(data);},refereeLicense:()=>{throw Error('private get must never be used');}};
  });
  await page.addScriptTag({content:fs.readFileSync('modules/main-app/player-cards.js','utf8')});
  const open=uid=>page.evaluate(uid=>BXHPlayerCardsFeature.handlePlayerCard('card-open',{getAttribute:()=>uid}),uid);
  await open('alice');await page.getByText('核定裁判摘要',{exact:true}).waitFor();let html=await page.locator('#player-card-overlay').innerHTML();
  for(const secret of ['SECRET_EMAIL','SECRET_PHONE','SECRET_APPROVER','SECRET_PERSON','SECRET_PHOTO','alice'])assert.ok(!html.includes(secret),secret);
  assert.ok(html.includes('核定姓名'));assert.ok(html.includes('有效'));
  await page.evaluate(()=>expiry.at(-1)());await page.getByText(/裁判摘要已過期/).waitFor();assert.equal(await page.getByText('核定裁判摘要',{exact:true}).count(),0);
  db.put('refereeCertificates/alice',{...db.read('refereeCertificates/alice'),qualificationStatus:'disabled'});
  await open('alice');await page.getByText(/已停用/).waitFor();
  await open('bob');await page.waitForFunction(()=>playerCardsUI.refereeSummary?.loading===false);assert.equal(await page.getByText('核定裁判摘要',{exact:true}).count(),0);
  await page.evaluate(()=>window.fail=true);await open('alice');await page.getByText(/裁判摘要暫時無法確認/).waitFor();assert.equal(await page.getByText('核定裁判摘要',{exact:true}).count(),0);
  await page.evaluate(()=>{window.fail=false;window.defer=true;});await open('alice');await page.evaluate(()=>window.defer=false);await open('bob');await page.waitForFunction(()=>playerCardsUI.refereeSummary?.loading===false);
  await page.evaluate(()=>resolveSummary({ok:true,summary:{name:'LATE_PRIVATE_NAME',number:'R000019',level:1,status:'active',experience:null}}));
  assert.equal(await page.getByText(/LATE_PRIVATE_NAME/).count(),0);
  const before=await page.evaluate(()=>summaryCalls.length);await page.evaluate(()=>window.BXH_REFEREE_PUBLIC_SUMMARY_V1=false);await open('alice');assert.equal(await page.evaluate(()=>summaryCalls.length),before);
  assert.deepEqual(errors,[]);assert.equal(db.commits,0);
  console.log('PASS public card: separate read-only whitelist, no private calls/leaks, no-certificate hidden, disabled/error/expiry accurate, late responses dropped, rollout default gate');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
