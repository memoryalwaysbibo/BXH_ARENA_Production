'use strict';
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((_,r)=>r.end('<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:12px}button{max-width:100%;white-space:normal}.btn-row{display:flex;flex-wrap:wrap;gap:8px}.panel{padding:12px}</style><main id="app"></main><p id="notice"></p>'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.addScriptTag({content:fs.readFileSync('modules/main-app/bracket-commit.js','utf8')});
 const core=fs.readFileSync('modules/main-app/core.js','utf8'),a=core.indexOf('// Bracket generation is detached'),b=core.indexOf('function canReshuffleBracket(){',a);
 assert(a>0&&b>a);
 await page.addScriptTag({content:`
 let state={id:'r',cloudCode:'ROOM',meta:{formatType:'single'},players:[{id:'a'},{id:'b'}],matches:[],archiveStatus:'ongoing'},firebaseUser={uid:'u'},currentRole='admin',activeTab='people';
 const clone=x=>JSON.parse(JSON.stringify(x));
 let serverState=clone(state),publicState=clone(state),generations=0,success=0,writeCount=0,release=null,fail=true;
 window.cloudSync={
  readBracketFromServer:async()=>({ok:true,data:clone(serverState),publicData:clone(publicState)}),
  pushUpdate:async(code,snapshot,options)=>{writeCount++;if(fail)return false;await new Promise(r=>release=r);BXHBracketCommit.assertWrite(serverState,snapshot,options);serverState=clone(snapshot);publicState=clone(snapshot);return true;}
 };
 const enqueueCloudStateWrite=(code,snapshot,options)=>window.cloudSync.pushUpdate(code,snapshot,options);
 async function saveRecord(){return true;}
 function generateBracket(){generations++;state.drawnAt=100;state.bracketSize=2;state.matches=[{id:'m'+generations,bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}];return true;}
 function showToast(s){success++;document.querySelector('#notice').textContent=s;}
 function renderPreservingScroll(){render();}
 function entryRosterValid(){return true;}
 ${core.slice(a,b)}
 function render(){document.querySelector('#app').innerHTML=bracketCommitStatusHtml()+bracketDrawButtonHtml()+'<button id="start" '+(bracketCommitBlocked()?'disabled':'')+'>開賽</button>';}
 document.addEventListener('click',e=>{if(e.target.dataset.action==='draw-bracket')bracketCommitController().submit();if(e.target.dataset.action==='bracket-commit-submit')bracketCommitController().submit();});
 window.fixture={stats:()=>({generations,success,writeCount,local:clone(state),server:clone(serverState)}),retry:()=>{fail=false;},release:()=>release(),canStart:()=>verifyBracketBeforeStart()};
 render();
 `});
 await page.getByRole('button',{name:'抽籤',exact:true}).click();
 await page.getByRole('status').getByText('資料上傳中…',{exact:true}).waitFor();
 await page.getByRole('progressbar',{name:'資料上傳中'}).waitFor();
 await page.waitForTimeout(250);
 assert.equal(await page.getByRole('status').getAttribute('aria-busy'),'true');
 await page.getByRole('button',{name:'重試上傳'}).waitFor();
 assert.equal(await page.locator('#start').isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'抽籤',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'讀取雲端版本',exact:true}).count(),0);
 assert.equal(await page.getByRole('status').getByRole('button').count(),1);
 await page.getByRole('status').getByText('上傳失敗',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>fixture.stats())).success,0);
 await page.evaluate(()=>fixture.retry());
 await page.getByRole('button',{name:'重試上傳'}).click();
 await page.getByRole('button',{name:'上傳中…',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'上傳中…',exact:true}).isDisabled(),true);
 const during=await page.evaluate(()=>fixture.stats());assert.equal(during.generations,1);assert.equal(during.success,0);assert.equal(during.local.matches.length,0);
 await page.evaluate(()=>fixture.release());
 await page.locator('#notice').getByText('上傳成功',{exact:true}).waitFor();
 assert.equal(await page.locator('#start').isDisabled(),false);
 const after=await page.evaluate(()=>fixture.stats());assert.equal(after.generations,1);assert.equal(after.success,1);assert.equal(after.local.bracketDrawHistory.length,1);assert.equal(after.local.matches[0].id,after.server.matches[0].id);
 assert.equal(await page.evaluate(()=>fixture.canStart()),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS single-action bracket UI and actual bridge: failed save, disabled start/redraw, delayed retry, same pairing, server confirmation and mobile width');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
