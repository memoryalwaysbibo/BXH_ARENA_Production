'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright');
test('mobile page opens team settings and submits selected ranks through mounted UI',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const width of [320,390,430]){
   const page=await browser.newPage({viewport:{width,height:800}});await page.setContent('<!doctype html><html><body><main id="app"></main></body></html>');
   for(const file of ['team-ui.js','team-controller.js','team-mount.js'])await page.addScriptTag({path:path.join(__dirname,file)});
   await page.evaluate(()=>{window.commands=[];window.handle=BXHTeamMount.mount({container:document.querySelector('#app'),api:{list:async()=>({items:[],total:0}),members:async()=>({}),mine:async()=>({team:{id:'t',name:'戰隊甲',role:'captain',admission:{mode:'auto',minLadderTier:null,minTier:null}}}),command:async p=>{window.commands.push(p);return {ok:true};}}});});
   await page.locator('[data-team-action="tab"][data-value="mine"]').click();await page.getByText('招募設定').waitFor();
   assert.equal(await page.locator('[name=minLadderTier]').inputValue(),'');assert.equal(await page.locator('[name=minTier]').inputValue(),'');
   await page.selectOption('[name=minLadderTier]','黃金');await page.selectOption('[name=minTier]','b');await page.getByRole('button',{name:'儲存設定'}).click();
   await page.waitForFunction(()=>window.commands.length===1);const [payload]=await page.evaluate(()=>window.commands);
   assert.deepEqual(payload,{action:'admission',teamId:'t',policy:{mode:'auto',minLadderTier:'黃金',minTier:'b'}});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page must not overflow at '+width);
   await page.close();
  }
 }finally{await browser.close();}
});
