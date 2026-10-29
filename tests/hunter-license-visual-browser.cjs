'use strict';
// Real approved PNGs, production CSS and caller seam; every request is intercepted.
// No Auth, Firebase, player records, or live service can be reached.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const out=process.env.HUNTER_VISUAL_QA_OUTPUT||'test-results/hunter-license-visual';
const tiers=['ungraded','e','d','c','b','a','s','national'];
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),errors=[],requests=[],cases=[];let fail=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());requests.push(u.pathname);
   if(u.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><button id="open">開啟</button><button id="back">返回</button><main id="app" class="player-main"></main>'});
   if(/^\/assets\/hunter-ranks\/license-v911\/(ungraded|e|d|c|b|a|s|national)\.png$/.test(u.pathname))return fail==='decode'?route.fulfill({contentType:'image/png',body:'invalid image bytes'}):fail?route.abort():route.fulfill({contentType:'image/png',body:fs.readFileSync('.'+u.pathname)});
   if(u.pathname==='/avatar.png')return fail?route.abort():route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=','base64')});
   return route.abort();
  });
  await page.goto('http://127.0.0.1/fixture');
  const index=fs.readFileSync('index.html','utf8');
  for(const match of index.matchAll(/<link\b[^>]*href="([^"?]+\.css)(?:\?[^"]*)?"[^>]*>/g))if(!/^https?:/.test(match[1])&&fs.existsSync(match[1]))await page.addStyleTag({content:fs.readFileSync(match[1],'utf8')});
  for(const file of ['hunter-license-v21','hunter-license-visual'])await page.addScriptTag({content:fs.readFileSync('modules/main-app/'+file+'.js','utf8')});
  const core=fs.readFileSync('modules/main-app/core.js','utf8'),from=core.indexOf('  const playerName=',core.indexOf('function renderPlayerStatsTab(p)'));
  const declarations=core.slice(from,core.indexOf('  if(hunterProfileCache',from));
  const visual=core.match(/const visualLicense=(.*);/)[1];
  await page.addScriptTag({content:`const esc=s=>String(s).replaceAll('<','&lt;');let input={};const currentAuthUid=()=>'synthetic-display';const hunterProfileCache={numberIdentity:{status:'assigned',source:'player-number-ledger',uid:'synthetic-display',number:'101',authCreatedAtMilliseconds:'1788457487706'}};function caller(p,licenseGrade){${declarations}return ${visual};}function openCard(){const grade=BXHHunterLicenseV21.displayGrade({grade:input.grade,life:{},highest:{tier:'national'}},null);document.querySelector('#app').innerHTML='<section class="hunter-profile-shell">'+caller(input.profile,grade)+'</section>';}window.fixture={set:value=>{input=value;openCard();}};document.querySelector('#open').onclick=openCard;document.querySelector('#back').onclick=()=>document.querySelector('#app').replaceChildren();`});
  for(const width of [320,390,430,960]){
   await page.setViewportSize({width,height:1000});
   for(const tier of tiers)for(const name of ['黑爸','這是一個用於檢查換行的超長示範獵人名稱','SyntheticHunterWithAnExtremelyLongName']){
    const before=requests.length;
    await page.evaluate(({tier,name})=>fixture.set({profile:{displayName:' '+name+' ',realName:'不應顯示',equippedTitle:'national',playerId:'FAKE',joinedAt:'2026-01-01'},grade:{tier}}),{tier,name});
    await page.waitForFunction(()=>[...document.querySelectorAll('.hl3 img')].every(i=>i.complete&&i.naturalWidth>0));
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.hl3 img')].map(img=>img.decode()));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const geometry=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};return {name:rect('.hl3-identity h4'),rank:rect('.hl3-rank'),art:rect('.hl3-rank img'),meta:rect('.hl3-identity dl'),portrait:rect('.hl3-portrait'),card:rect('.hl3'),overflow:[...document.querySelectorAll('.hl3,.hl3-identity,.hl3-identity h4,.hl3-identity dd')].some(e=>e.scrollWidth>e.clientWidth+1),count:document.querySelectorAll('.hl3-rank').length,rankParent:document.querySelector('.hl3-rank').parentElement.className};});
    assert.ok(geometry.name.height>0&&geometry.meta.height>0,'Text requires working fonts '+JSON.stringify({width,tier,name,geometry}));assert.equal(geometry.overflow,false,JSON.stringify({width,tier,name,geometry}));assert.equal(geometry.count,1);
    assert.equal(await page.locator('.hl3-identity h4').textContent(),name);
    const values=await page.locator('.hl3-identity dd').allTextContents();assert.equal(values[0],'00101');assert.match(values[1],/2026\/9\/4/);assert.match(values[1],/01:44:47/);
    if(width<=560){assert.equal(geometry.rankParent,'hl3-identity');assert.ok(geometry.name.bottom<=geometry.rank.y+1);assert.ok(geometry.rank.bottom<=geometry.meta.y+1);}else{assert.equal(geometry.rankParent,'hl3-body');assert.ok(geometry.portrait.right<geometry.name.x);}
    assert.ok(geometry.art.x>=geometry.card.x&&geometry.art.right<=geometry.card.right,'badge stays within card');
    assert.ok(geometry.art.y>=geometry.card.y&&geometry.art.bottom<=geometry.card.bottom);
    assert.ok(requests.slice(before).filter(u=>u.includes('/license-v911/')).every(u=>u.endsWith('/'+tier+'.png')),'only active grade is requested');
    cases.push({width,tier,name,geometry});
    if(name==='黑爸')await page.locator('.hl3').screenshot({path:path.join(out,tier+'-'+width+'.png')});
    if(tier==='national'&&width<=390&&name!=='黑爸')await page.locator('.hl3').screenshot({path:path.join(out,(name.startsWith('Synthetic')?'long-en-':'long-zh-')+width+'.png')});
   }
  }
  for(const width of [320,390,430,960])for(const dimensions of [[60,120],[120,60]]){
   await page.setViewportSize({width,height:1000});
   await page.evaluate(([w,h])=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');c.fillStyle='#725e89';c.fillRect(0,0,w,h);c.fillStyle='#d9c68f';c.fillRect(w/3,h/3,w/3,h/3);fixture.set({profile:{displayName:'頭像測試',avatarUrl:canvas.toDataURL('image/png')},grade:{tier:'a'}});},dimensions);
   await page.waitForFunction(()=>document.querySelector('.hl3-portrait img').naturalWidth>0);
   const photo=await page.locator('.hl3-portrait img').evaluate(e=>({fit:getComputedStyle(e).objectFit,natural:[e.naturalWidth,e.naturalHeight],width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));
   assert.equal(photo.fit,'cover');assert.deepEqual(photo.natural,dimensions);assert.ok(photo.width>0&&photo.height>0);
  }
  // Resize the same card without re-rendering, then navigation and duplicate opens.
  for(const width of [320,960,390,430,960,320]){
   await page.setViewportSize({width,height:1000});await page.waitForFunction(w=>document.querySelector('.hl3-rank').parentElement.className===(w<=560?'hl3-identity':'hl3-body'),width);
   await page.click('#back');assert.equal(await page.locator('.hl3').count(),0);await page.click('#open');await page.click('#open');assert.equal(await page.locator('.hl3').count(),1);assert.equal(await page.locator('.hl3-rank').count(),1);
  }
  fail=true;await page.evaluate(()=>fixture.set({profile:{realName:'後備姓名',avatarUrl:'http://127.0.0.1/avatar.png'},grade:{tier:'d'}}));
  await page.waitForFunction(()=>document.querySelector('.hl3-rank img').hidden&&document.querySelector('.hl3-portrait img').hidden);
  assert.equal(await page.locator('.hl3-image-fallback').isVisible(),true);assert.equal(await page.locator('.hl3-portrait span').isVisible(),true);
  await page.locator('.hl3').screenshot({path:path.join(out,'image-failure-320.png')});
  await page.evaluate(()=>fixture.set({profile:{},grade:{tier:'pending',label:'對手資料待核對'}}));
  assert.equal(await page.locator('.hl3-rank img').count(),0);assert.equal(await page.locator('.hl3-identity h4').textContent(),'玩家');
  assert.equal(await page.locator('.hl3-rank strong').textContent(),'對手資料待核對');
  await page.locator('.hl3').screenshot({path:path.join(out,'pending-320.png')});
  fail='decode';await page.evaluate(()=>fixture.set({profile:{displayName:'解碼失敗測試'},grade:{tier:'b'}}));
  await page.waitForFunction(()=>document.querySelector('.hl3-rank img').hidden);assert.equal(await page.locator('.hl3-image-fallback').isVisible(),true);
  fail=false;await page.evaluate(()=>fixture.set({profile:{displayName:'重開測試',avatarUrl:'http://127.0.0.1/avatar.png'},grade:{tier:'s'}}));
  await page.waitForFunction(()=>[...document.querySelectorAll('.hl3 img')].every(i=>i.complete&&i.naturalWidth>0));
  assert.equal(await page.locator('.hl3-image-fallback').isVisible(),false);assert.equal(await page.locator('.hl3-portrait span').isVisible(),false);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'passed',artwork:'approved v9.1.1 embedded PNGs',avatarAspectCases:8,imageFailureCases:['request abort','decode error'],cases:cases.length,results:cases,errors,requests},null,2));
  console.log('PASS '+cases.length+' real-art width/rank/name cases; active-image loading, failure, pending, caller, resize, reopen/back/repeat');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
