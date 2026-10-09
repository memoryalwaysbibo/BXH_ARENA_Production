'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
(async()=>{
 const browser=await chromium.launch(process.env.HC_A1_BROWSER?{executablePath:process.env.HC_A1_BROWSER}:{});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<main id="app"></main><style>body{margin:0;padding:12px;background:#161822;color:#eee;font-family:sans-serif}.panel{padding:16px;border:1px solid #555}.btn{padding:12px}.player-tabs{display:flex;overflow:auto}input{padding:12px}</style>');
 await page.addStyleTag({content:fs.readFileSync('modules/main-css/hunter-clash-entry.css','utf8')});
 await page.addScriptTag({content:fs.readFileSync('modules/main-app/hunter-clash-entry.js','utf8')});
 // Exercise the real module and both production navigation render seams.
 const core=fs.readFileSync('modules/main-app/core.js','utf8');
 const visible=core.match(/function playerVisibleTabs\(\)\{[^\n]+\}/)[0];
 const nav=core.slice(core.indexOf('function renderPlayerNavHtml(){'),core.indexOf('\nconst {mailboxContext',core.indexOf('function renderPlayerNavHtml(){')));
 await page.addScriptTag({content:`const PLAYER_TABS=[['home','賽事大廳'],['registered','我的賽程'],['host','我的房間'],['stats','獵人檔案'],['ladder','天梯排行']];let playerActiveTab='clash';const esc=s=>String(s);let calls=0,stops=0;const hunterClashEntry=BXHHunterClashEntry.createEntry({changed:render,media:()=>({getUserMedia:async()=>{calls++;const stream=document.createElement('canvas').captureStream();for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stops++;stop();};}return stream;}})});${visible}${nav}function render(){document.querySelector('#app').innerHTML=renderPlayerNavHtml()+hunterClashEntry.render();hunterClashEntry.bind(document,playerActiveTab==='clash');}document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)hunterClashEntry.handle(b.dataset.action);});window.fixture={authorize:async()=>{window.cloudAuth={getHunterClashAccess:async uid=>uid==='arena-player'};hunterClashEntry.session({uid:'arena-player',email:'arena@example.test'},{uid:'arena-player',active:true,displayName:'黑爸'});await new Promise(r=>setTimeout(r,0));},exit:()=>{playerActiveTab='home';render();},stats:()=>({calls,stops})};render();`});
 assert.equal(await page.getByRole('button',{name:'獵人交鋒',exact:true}).count(),0);
 await page.evaluate(()=>fixture.authorize());assert.equal(await page.getByRole('button',{name:'獵人交鋒',exact:true}).count(),1);
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'加入對戰',exact:true}).click();await page.waitForTimeout(20);assert.equal(await page.locator('input[maxlength="4"]').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('button',{name:'返回',exact:true}).click();}
 await page.getByRole('button',{name:'加入對戰',exact:true}).click();await page.waitForTimeout(20);await page.evaluate(()=>fixture.exit());assert.deepEqual(await page.evaluate(()=>fixture.stats()),{calls:4,stops:4});assert.deepEqual(errors,[]);console.log('PASS A1 navigation gate, ARENA identity, join/back, camera cleanup and 320/390/430px layout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
