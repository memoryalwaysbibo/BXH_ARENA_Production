const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../..');
test('hunter board renders safe public rows and scrolls its table inside a mobile viewport',async({page})=>{
 await page.setContent('<style>*{box-sizing:border-box}body{margin:12px;background:#14131a;color:#eee;font-family:sans-serif}.panel{padding:16px}.rank-scroll{overflow:auto}.rank-table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px}.hint{font-size:13px}.btn{padding:10px}</style><main id="board"></main>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'modules/main-css/hunter-leaderboard.css'),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(root,'modules/main-app/hunter-leaderboard.js'),'utf8')});
 await page.evaluate(()=>{
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const row={key:'me',playerName:'<img src=x onerror=alert(1)>測試玩家',tier:'a',rank:1,score:65,strength:63,matchCount:47,replayedHighest:'a'};
  const data={ok:true,version:'hunter-leaderboard-v1',promotionPolicy:'medium-or-larger-v1',status:'partial',generation:'g1793000000000-abcdefabcdef',page:1,pageSize:50,total:1,hasMore:false,rows:[row],mine:row,counts:{eligible:2,ranked:1,pending:1,noHistory:0,notPublic:0},updatedAt:1793000000000,startedAt:1792999900000,highest:{tier:'a'}};
  const paint=()=>document.getElementById('board').innerHTML=view.render(esc);
  const view=window.BXHHunterLeaderboard.create({load:async()=>data,identity:()=> 'self',onChange:paint});paint();
 });
 await expect(page.getByRole('cell',{name:/測試玩家/})).toBeVisible();
 await expect(page.getByRole('columnheader',{name:'累計有效對戰'})).toBeAttached();
 await expect(page.getByRole('cell',{name:'47 場',exact:true})).toBeAttached();
 await expect(page.locator('img')).toHaveCount(0);
 await expect(page.getByText('第 1 名')).toBeVisible();
 const info=page.locator('details.hunter-board-info'),toggle=info.locator('summary');
 await expect(info).not.toHaveAttribute('open','');
 await expect(page.getByText(/目前不能據此宣告全服最高/)).not.toBeVisible();
 await expect(toggle).toContainText('1 位待核對');
 await toggle.click();
 await expect(info).toHaveAttribute('open','');
 await expect(page.getByText(/目前不能據此宣告全服最高/)).toBeVisible();
 await expect(page.getByText(/更新時間（台灣）/)).toBeVisible();
 await toggle.press('Enter');
 await expect(info).not.toHaveAttribute('open','');
 await expect(page.getByText(/目前不能據此宣告全服最高/)).not.toBeVisible();
 const dimensions=await page.evaluate(()=>({width:innerWidth,body:document.documentElement.scrollWidth,table:document.querySelector('.rank-scroll').scrollWidth,container:document.querySelector('.rank-scroll').clientWidth}));
 expect(dimensions.body).toBeLessThanOrEqual(dimensions.width);
 if(dimensions.width<650)expect(dimensions.table).toBeGreaterThan(dimensions.container);
});

test('rankings switch between ladder hunter and real team ranking read without mobile squeeze',async({page})=>{
 await page.setContent('<style>*{box-sizing:border-box}body{margin:12px}.panel{padding:16px}.btn{padding:10px}.rank-scroll{overflow:auto}</style><main id="board"></main>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'modules/main-css/hunter-leaderboard.css'),'utf8')});
 await page.evaluate(()=>{
  window.calls=[];window.uid='player1';window.currentAuthUid=()=>uid;window.userProfile={active:true,role:'player'};window.BXH_TEAM_FULL_ENABLED=true;
  window.esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.renderLadderLeaderboardPage=()=>'<h2>天梯資料</h2>';
  window.BXHHunterLeaderboard={create:()=>({render:()=>'<h2>獵人資料</h2>'})};
  window.engagementService={tournamentOperation:async(name,payload)=>{calls.push({name,payload});return {items:[{id:'bxh',name:'<img src=x>測試戰隊名稱很長很長也不能擠壓',captainName:'黑爸',rank:1,strength:511,memberCount:1,level:1}],total:1,partial:true,excluded:1,offset:0,limit:20};}};
  window.renderPreservingScroll=()=>document.getElementById('board').innerHTML=renderLadderLeaderboardPage(false);
 });
 for(const file of ['team-leaderboard.js','hunter-leaderboard-integration.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'modules/main-app',file),'utf8')});
 await page.evaluate(()=>renderPreservingScroll());
 for(const label of ['天梯榜','獵人榜','戰隊榜'])await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();
 expect(await page.evaluate(()=>calls.length)).toBe(0);
 await page.getByRole('button',{name:'戰隊榜',exact:true}).click();
 await expect(page.getByText('黑爸',{exact:true})).toBeVisible();
 await expect(page.getByText(/另有 1 支尚未列榜/)).toBeVisible();
 expect(await page.evaluate(()=>calls)).toEqual([{name:'teamRead',payload:{action:'ranking',query:{offset:0,limit:20}}}]);
 await expect(page.locator('img')).toHaveCount(0);
 for(const width of [320,390,430,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.getByRole('button',{name:'獵人榜',exact:true}).click();await expect(page.getByRole('heading',{name:'獵人資料'})).toBeVisible();
 await page.getByRole('button',{name:'天梯榜',exact:true}).click();await expect(page.getByRole('heading',{name:'天梯資料'})).toBeVisible();
 await page.evaluate(()=>{uid=null;renderPreservingScroll()});await expect(page.getByRole('button',{name:'戰隊榜',exact:true})).toHaveCount(0);
});
