'use strict';
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const {memory}=require('./helpers/arena-pk-memory.cjs'),{createService}=require('../hunter-clash/arena/service.cjs'),adapter=require('../hunter-clash/arena/adapter.js');
(async()=>{
 const m=memory();for(const uid of ['a','b'])m.data.set('users/'+uid,{active:true,role:'player',displayName:uid==='a'?'黑爸':'大黑'});m.data.set('systemSettings/hunterClash',{enabled:true,environment:adapter.ENV,allowedUids:['a','b'],pairingTtlMs:120000,rules:{version:adapter.VERSION,targetScore:4}});
 const service=createService({db:m.db,auth:{app:{options:{projectId:m.db.projectId}},verifyIdToken:async uid=>({uid})}});
 const cwd=process.cwd(),server=http.createServer((req,res)=>{const file=path.resolve(cwd,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(cwd+path.sep)){res.writeHead(403);return res.end();}try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.HC_A1_BROWSER||undefined});const errors=[];
 try{
  const core=fs.readFileSync('modules/main-app/core.js','utf8');const extract=name=>{const a=core.indexOf('function '+name+'('),b=core.indexOf('\nfunction ',a+1);return core.slice(a,b);};
  async function page(uid){const p=await browser.newPage({viewport:{width:390,height:844}});p.on('pageerror',e=>errors.push(e.message));await p.exposeFunction('fixtureCall',async payload=>{try{return await service.run(uid,payload.operation,payload.input);}catch(e){return {error:e.message};}});await p.goto('http://127.0.0.1:'+server.address().port+'/tests/fixtures/blank.html');await p.setContent('<base href="/"><div id="shell"></div><style>body{margin:0;padding:8px}.player-tabs{display:flex;overflow:auto}</style>');
   for(const src of ['modules/main-app/domain-utils.js','modules/main-app/hunter-utils.js','hunter-clash/arena/adapter.js','hunter-clash/arena/history.js','hunter-clash/arena/runtime.js','hunter-clash/arena/vendor/qrcode.min.js','hunter-clash/arena/vendor/jsQR.js','modules/main-app/hunter-clash-entry.js'])await p.addScriptTag({url:'http://127.0.0.1:'+server.address().port+'/'+src});
   await p.addScriptTag({content:`window.engagementService={connectionInfo:()=>({projectId:'bxh-arena'}),hunterClash:async payload=>{const result=await fixtureCall(payload);if(result.error){const e=Error(result.error);e.code='functions/failed-precondition';throw e;}return result;}};const esc=s=>String(s);const PLAYER_TABS=[['home','賽事大廳'],['registered','我的賽程'],['host','我的房間'],['stats','獵人檔案'],['ladder','天梯排行']];let playerActiveTab='clash';const hunterClashEntry=BXHHunterClashEntry.createEntry({changed:render});${extract('playerVisibleTabs')}function render(){document.querySelector('#shell').innerHTML=playerVisibleTabs().map(([key,label])=>'<button data-tab="'+key+'">'+label+'</button>').join('')+(playerActiveTab==='clash'?hunterClashEntry.render():'<div id="license"></div>');hunterClashEntry.bind(document,playerActiveTab==='clash');if(playerActiveTab==='stats')document.querySelector('#license').innerHTML=BXHArenaPK.renderLicense({tab:'records',analyze:()=>{},radar:()=>'',card:r=>'<p>'+r.playerName+' vs '+r.opponent.name+' '+r.scoreFor+':'+r.scoreAgainst+'</p>'});}document.addEventListener('click',e=>{if(e.target.dataset.tab){playerActiveTab=e.target.dataset.tab;render();}const a=e.target.closest('[data-action]');if(a?.dataset.action==='hunter-pk-refresh')BXHArenaPK.load(true);});window.fixture={shell:()=>render(),switch:()=>{hunterClashEntry.session({uid:'different',getIdTokenResult:async()=>({claims:{}})},{uid:'different',active:true,role:"player",displayName:'別人'});render();}};hunterClashEntry.session({uid:'${uid}',getIdTokenResult:async()=>({token:"fixture-token",claims:{}})},{uid:'${uid}',active:true,role:"player",displayName:'${uid==='a'?'黑爸':'大黑'}'});render();`});return p;
  }
  const a=await page('a'),b=await page('b');
  await a.locator('[data-op=createChallenge]').waitFor();
  for(const [accent,expected] of [['#ffd700','rgb(255, 215, 0)'],['#00f3ff','rgb(0, 243, 255)'],['#ff3366','rgb(255, 51, 102)'],['#71d995','rgb(113, 217, 149)']]){
   await a.evaluate(accent=>{document.documentElement.style.setProperty('--accent-color',accent);document.documentElement.style.setProperty('--glass-surface-strong','rgb(8,24,19)');},accent);
   await a.waitForFunction(expected=>{const s=document.querySelector('[data-hc-runtime-host]').firstChild.shadowRoot;return getComputedStyle(s.querySelector('.home-actions strong')).color===expected&&getComputedStyle(s.querySelector('#match')).backgroundImage.includes('8, 24, 19');},expected);
  }
  await a.evaluate(()=>{document.documentElement.style.removeProperty('--accent-color');document.documentElement.style.removeProperty('--glass-surface-strong');});
  await a.locator('[data-op=createChallenge]').click();await a.locator('.pairing-code').waitFor();const code=await a.locator('.pairing-code').innerText();assert.match(code,/^[2-9A-HJ-NP-Z]{4}$/);assert.equal(await a.locator('#login').count(),0);assert.equal(await a.locator('[name=playerName]').count(),0);
  // Decode the actual generated QR through the same decoder/parser used by the scanner.
  const qr=await a.evaluate(async()=>{const host=document.querySelector('[data-hc-runtime-host]').firstChild,canvas=host.shadowRoot.querySelector('.qr canvas');const {decodePairingPixels}=await import('/hunter-clash/arena/scanner.mjs');return decodePairingPixels(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),jsQR);});assert.equal(qr.challengeId,[...m.data.keys()].find(k=>k.startsWith('arenaPKChallenges/')).split('/')[1]);
  await b.locator('[data-op=join]').click();await b.locator('[name=pairingCode]').fill(code);await b.locator('[data-op=acceptCode]').click();await b.locator('#match[data-stage=accepted]').waitFor();await a.locator('#match[data-stage=accepted]').waitFor({timeout:8000});await a.locator('[data-op=start]').click();await b.locator('[data-op=start]').click();await a.locator('#match[data-stage=in_progress]').waitFor({timeout:8000});
  await a.locator('[data-op=recordRound][data-player="0"][data-finish=burst]').click();await a.waitForFunction(()=>document.querySelector('[data-hc-runtime-host]').firstChild.shadowRoot.querySelector('.points').textContent==='2');await a.locator('[data-op=recordRound][data-player="0"][data-finish=burst]').click();await a.locator('#match[data-stage=final_pending]').waitFor();await b.locator('#match[data-stage=final_pending]').waitFor({timeout:8000});await b.locator('[data-op=confirmFinish]').click();assert.match(await b.locator('.confirmation-wait').innerText(),/等待 黑爸 確認中/);assert.equal(await b.locator('[data-op=dispute]').isVisible(),false);
  // Each phone opens its own analysis, using one shared panel at every viewport.
  for(const [phone,name] of [[a,'黑爸'],[b,'大黑']]){
   await phone.locator('.room-analysis summary').click();
   assert.equal(await phone.locator('.room-stat').count(),1);
   assert.equal(await phone.locator('.room-stat > strong').innerText(),name);
   assert.equal(await phone.locator('.analysis-player-tabs button[aria-pressed=true]').innerText(),name);
  }
  await a.locator('.analysis-player-tabs button',{hasText:'大黑'}).click();
  assert.equal(await a.locator('.room-stat > strong').innerText(),'大黑');
  await a.locator('[data-op=reconnect]').click();
  assert.equal(await a.locator('.room-stat > strong').innerText(),'大黑');
  await a.locator('[data-op=leave]').click();await a.locator('.recovery-panel').waitFor();assert.equal(await a.locator('[data-op=createChallenge]').isVisible(),false);
  assert.equal([...m.data.values()].filter(v=>v.status==='cancelled').length,0);assert.equal(m.data.get('arenaPKPlayers/a'),undefined);
  await a.getByRole('button',{name:'獵人檔案',exact:true}).click();await a.evaluate(()=>sessionStorage.clear());
  await a.getByRole('button',{name:'獵人交鋒',exact:true}).click();await a.locator('#match[data-stage=final_pending]').waitFor();await a.locator('#history summary').click();assert.match(await a.locator('.pending-history').innerText(),/尚未計入/);
  await a.locator('[data-op=confirmFinish]').click();await a.locator('#match[data-stage=completed]').waitFor({timeout:8000});await b.locator('#match[data-stage=completed]').waitFor({timeout:8000});
  await a.waitForFunction(()=>BXHArenaPK.state().status==='ready');assert.equal(await a.evaluate(()=>BXHArenaPK.state().records.length),1);
  await a.evaluate(()=>fixture.shell());assert.equal(await a.locator('#match[data-stage=completed]').count(),1);
  await a.getByRole('button',{name:'獵人檔案',exact:true}).click();assert.match(await a.locator('#license').innerText(),/黑爸 vs 大黑 4:0/);assert.equal(await a.locator('#app').count(),0);
  await a.getByRole('button',{name:'獵人交鋒',exact:true}).click();await a.locator('#match[data-stage=completed]').waitFor();
  await a.locator('.room-analysis summary').click();
  for(const width of [320,390,430,1024]){assert.equal(await a.locator('.room-stat').count(),1);await a.setViewportSize({width,height:844});assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await a.locator('img').evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0)),true);}
  // Five-game analysis fixture verifies that the same selector controls the radar.
  const finished=(await service.run('b','getChallenge',{challengeId:qr.challengeId})).challenge;
  const analysisRoom={...finished,challengeId:'analysis-fixture',gameNumber:5,games:Array.from({length:4},(_,i)=>({number:i+1,score:finished.score,winnerUid:finished.winnerUid,rounds:finished.rounds}))};
  const analysis=await browser.newPage({viewport:{width:390,height:844}});
  await analysis.goto('http://127.0.0.1:'+server.address().port+'/tests/fixtures/blank.html');
  await analysis.evaluate(async room=>{
   const {mountMobile}=await import('/hunter-clash/arena/mobile.mjs');
   const root=document.body.attachShadow({mode:'open'});root.innerHTML='<link rel="stylesheet" href="/hunter-clash/arena/mobile.css"><div id="message"></div><main id="app"></main>';
   const values=new Map([['arena-pk:mobile:last:b',room.challengeId]]),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
   window.analysisMount=mountMobile(root,{playerName:()=> '大黑',watch:fn=>{fn({uid:'b'});return()=>{};},transport:async()=>({challenge:room}),history:async()=>({status:'empty',total:0,records:[]})},{storage});
  },analysisRoom);
  await analysis.locator('.room-analysis summary').click();
  await analysis.locator('.license-radar-svg').waitFor({state:'visible'});
  assert.equal(await analysis.locator('.room-stat > strong').innerText(),'大黑');
  assert.match(await analysis.locator('.license-radar-svg').getAttribute('aria-label'),/^大黑 /);
  await analysis.locator('.analysis-player-tabs button',{hasText:'黑爸'}).click();
  assert.equal(await analysis.locator('.room-stat > strong').innerText(),'黑爸');
  assert.match(await analysis.locator('.license-radar-svg').getAttribute('aria-label'),/^黑爸 /);
  assert.equal(await analysis.locator('.room-stat').count(),1);
  await analysis.evaluate(()=>analysisMount.dispose());await analysis.close();
  const recoveryPage=await browser.newPage({viewport:{width:390,height:844}});
  await recoveryPage.goto('http://127.0.0.1:'+server.address().port+'/tests/fixtures/blank.html');
  await recoveryPage.evaluate(async()=>{
   const {mountMobile}=await import('/hunter-clash/arena/mobile.mjs');
   const root=document.body.attachShadow({mode:'open'});root.innerHTML='<div id="message"></div><main id="app"></main>';
   const values=new Map([['arena-pk:mobile:last:a','pk_stale']]),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
   window.recoveryValues=values;window.lookupMissing=false;
   window.recoveryMount=mountMobile(root,{playerName:()=> '黑爸',watch:fn=>{fn({uid:'a'});return()=>{};},transport:async()=>{throw window.lookupMissing?Object.assign(Error('challenge-unavailable'),{definitive:true}):Error('offline');},history:async()=>({status:'empty',total:0,records:[]})},{storage,accountStorage:storage});
  });
  await recoveryPage.locator('[data-op="recoveryBack"]').waitFor({state:'visible'});
  await recoveryPage.waitForFunction(()=>document.body.shadowRoot.querySelector('#message').textContent.includes('紀錄仍保留'));
  assert.equal(await recoveryPage.evaluate(()=>recoveryValues.get('arena-pk:mobile:last:a')),'pk_stale');
  await recoveryPage.evaluate(()=>{lookupMissing=true;});
  await recoveryPage.locator('[data-op="recoveryBack"]').click();
  await recoveryPage.locator('[data-op="createChallenge"]').waitFor({state:'visible'});
  assert.equal(await recoveryPage.locator('[data-op="createChallenge"]').isEnabled(),true);
  assert.equal(await recoveryPage.locator('.recovery-panel').isVisible(),false);
  assert.equal(await recoveryPage.evaluate(()=>recoveryValues.has('arena-pk:mobile:last:a')),false);
  await recoveryPage.evaluate(()=>recoveryMount.dispose());await recoveryPage.close();
  await a.evaluate(()=>fixture.switch());assert.equal(await a.getByRole('button',{name:'獵人交鋒',exact:true}).count(),0);assert.equal(await a.evaluate(()=>BXHArenaPK.state().records.length),0);assert.deepEqual(errors,[]);console.log('PASS A2/A3 real module two-player lifecycle, actual QR decoding, four-code join, automatic sync, waiting, shared history, route/session cleanup and 320/390/430px');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
