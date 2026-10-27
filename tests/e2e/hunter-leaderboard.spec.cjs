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
 await expect(page.getByText(/目前不能據此宣告全服最高/)).toBeVisible();
 const dimensions=await page.evaluate(()=>({width:innerWidth,body:document.documentElement.scrollWidth,table:document.querySelector('.rank-scroll').scrollWidth,container:document.querySelector('.rank-scroll').clientWidth}));
 expect(dimensions.body).toBeLessThanOrEqual(dimensions.width);
 if(dimensions.width<650)expect(dimensions.table).toBeGreaterThan(dimensions.container);
});
