'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
for(const width of [390,1280])test('team display, compact absence and saved switch at '+width+'px',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<style>body{margin:0;padding:12px;box-sizing:border-box;background:#17131a;color:white;--metal:#b9b4bf;--ivory:#eee;--gold:#d9b95c;--font-d:sans-serif}*{box-sizing:border-box}</style><main id="app"></main>');
  await page.addScriptTag({content:`
   let firebaseUser={uid:'p'},ladderPublicLoaded=true,ladderPublicError='',ladderPublicData={players:[{uid:'p',playerName:'吳健凱',seasonPoints:521,careerPoints:521,equippedBadge:{name:'七日常客',rarity:'common'}},{uid:'q',playerName:'無戰隊玩家',seasonPoints:400,careerPoints:400}]};
   function currentAuthUid(){return firebaseUser.uid;}function renderLadderLeaderboardPage(){return '';}function ladderLeaderboardTable(){return '';}
   function rankLadderRows(rows){return rows.map((p,i)=>({...p,__rank:i+1}));}function ladderTierFromPoints(){return '黃金';}
   const LADDER_TIER_INDEX={黃金:3};
   window.qa={showTeam:true,name:'歸仁小隊🐢超級長名稱測試測試測試',calls:0,fail:false};
   window.engagementService={ladderTeamDisplay:async payload=>{await new Promise(r=>setTimeout(r,10));if(payload.action==='settings')return {ok:true,showTeam:qa.showTeam};if(payload.action==='save'){if(qa.fail)throw Error('offline');qa.showTeam=payload.showTeam;return {ok:true,showTeam:qa.showTeam};}qa.calls++;return {ok:true,version:1,teams:{p:qa.showTeam&&qa.name?{name:qa.name}:null,q:null}};}};
  `});
  await page.addScriptTag({path:path.join(root,'modules/main-app/ladder-team-display.js')});
  await page.addScriptTag({path:path.join(root,'ladder-secondary-ui.js')});
  await page.addScriptTag({content:`function render(){document.querySelector('#app').innerHTML=BXHLadderTeamDisplay.preferenceHtml()+ladderLeaderboardTable([],false);}function renderPreservingScroll(){render();}render();`});
  const toggle=page.locator('[data-ladder-team-display]');await page.waitForFunction(()=>!document.querySelector('[data-ladder-team-display]').disabled);
  await page.locator('.ladder-player-team').waitFor();
  assert.deepEqual(await page.locator('.ladder-player-block').first().locator(':scope > *').evaluateAll(elements=>elements.map(e=>e.className.split(' ')[0])),['ladder-player-link','ladder-player-team','title-chip']);
  assert.equal(await page.locator('.ladder-player-block').nth(1).locator(':scope > *').count(),1);
  assert.equal(await page.locator('.ladder-player-team').evaluate(el=>getComputedStyle(el).textOverflow),'ellipsis');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await toggle.uncheck();await page.waitForFunction(()=>!document.querySelector('[data-ladder-team-display]').disabled);await page.waitForFunction(()=>!document.querySelector('.ladder-player-team'));
  await page.evaluate(()=>render());assert.equal(await toggle.isChecked(),false);
  await toggle.check();await page.locator('.ladder-player-team').waitFor();
  await page.evaluate(()=>{qa.name=null;BXHLadderTeamDisplay.invalidate();render();});await page.waitForFunction(()=>!document.querySelector('.ladder-player-team'));
  await page.evaluate(()=>{qa.name='BXH';BXHLadderTeamDisplay.invalidate();render();});await page.getByText('（BXH）',{exact:true}).waitFor();
  await page.evaluate(()=>qa.fail=true);await toggle.click();await page.getByText(/儲存尚未確認/).waitFor();await page.locator('[data-ladder-team-retry]').click();await page.waitForFunction(()=>!document.querySelector('[data-ladder-team-display]').disabled);assert.equal(await toggle.isChecked(),true);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
