'use strict';
// Isolated production PASS components, no Firebase account or external writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
(async()=>{
 const launch={headless:true,args:['--no-sandbox']};if(process.env.BXH_BROWSER_EXECUTABLE)launch.executablePath=process.env.BXH_BROWSER_EXECUTABLE;
 const browser=await chromium.launch(launch);
 try{
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.abort());
   await page.setContent('<!doctype html><html lang="zh-Hant"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;background:#161616;color:white;font:16px sans-serif}*{box-sizing:border-box}.panel{padding:12px;border:1px solid #666;margin:8px 0}.btn{padding:10px}.hint{color:#aaa}</style><main id="app"></main></html>');
   await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../modules/main-app/pass-return.css'),'utf8')});
   for(const file of ['pass-return.js','pass-return-ui.js'])await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../modules/main-app',file),'utf8')});
   await page.evaluate(()=>{
    const m={id:'m1',seq:1,station:1,bracket:'SE',round:0,skippedAt:100,skipWaitFor:['dep'],status:'pending',a:{playerId:'a'},b:{playerId:'b'}};
    const dep={id:'dep',seq:2,station:2,bracket:'SE',round:0,status:'in_progress',a:{playerId:'c'},b:{playerId:'d'}};
    window.st={cloudCode:'BXH-TESTAA',meta:{formatType:'single',stations:2},startedAt:1,matches:[m,dep],courtAssignments:{court1:{currentMatchId:null},court2:{currentMatchId:'dep'}}};
    window.bindings={canOperate:()=>true,candidates:()=>[],name:id=>id==='a'?'測試選手甲非常長的名稱測試':'測試選手乙',label:m=>'第'+m.seq+'場',blocked:()=>false,canManage:true,courtCount:2,accepts:()=>true,now:120100,busy:false};
    window.render=()=>document.getElementById('app').innerHTML=BXHPassReturnUI.idle(st,1,bindings)+BXHPassReturnUI.skipped(st,bindings);
    window.render();
   });
   await page.getByText('可接手場次（0）',{exact:true}).click();
   assert(await page.getByText('等待 PASS 前置場次完成',{exact:true}).first().isVisible());
   assert(await page.locator('[data-action="claim-skipped-match"]').first().isDisabled());
   await page.evaluate(()=>{st.matches[1].completed=true;render();});
   await page.getByText('可接手場次（1）',{exact:true}).click();
   assert(await page.locator('[data-action="claim-skipped-match"]').first().isEnabled());
   const details=page.locator('.pass-return-row details');await details.locator('summary').click();assert(await details.getByText('台2｜空閒',{exact:true}).isVisible());
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile overflow');
   assert.deepEqual(errors,[]);await page.close();console.log('PASS production PASS controls in Chromium:',width);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
