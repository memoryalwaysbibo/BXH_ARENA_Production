'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('modules/main-app/hunter-clash-entry.js','utf8');
function entry(options){const context={window:{},navigator:{},Promise};vm.runInNewContext(source,context);return context.window.BXHHunterClashEntry.createEntry(options);}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const actor=(uid,claims={hunterClashA1:true})=>({uid,getIdTokenResult:async()=>({claims})});
const root=()=>{const video={play:async()=>{}};const status={textContent:''};return{video,status,querySelector:s=>s==='[data-hc-camera]'?video:status};};
test('no login, absent claim, inactive and mismatched profile fail closed',async()=>{
  const e=entry();e.session(null,null);assert.equal(e.visible(),false);
  e.session(actor('a',{}),{uid:'a',active:true,hunterClashA1:true});await flush();assert.equal(e.visible(),false);
  e.session(actor('a'),{uid:'a',active:false});await flush();assert.equal(e.visible(),false);
  e.session(actor('a'),{uid:'b',active:true});await flush();assert.equal(e.visible(),false);
});
test('stale claims cannot authorize the next account',async()=>{
  let resolve;const e=entry();e.session({uid:'a',getIdTokenResult:()=>new Promise(r=>resolve=r)},{active:true});await flush();
  e.session(actor('b',{}),{active:true});resolve({claims:{hunterClashA1:true}});await flush();assert.equal(e.visible(),false);
});
test('uses escaped ARENA identity without second login or writable name',async()=>{
  const e=entry();e.session(actor('a'),{active:true,displayName:'<黑爸>'});await flush();assert.equal(e.visible(),true);
  const html=e.render();assert.match(html,/&lt;黑爸&gt;/);assert.doesNotMatch(html,/password|email|name="playerName"|<form/);
  assert.match(html,/hunter-clash-create/);assert.match(html,/hunter-clash-join/);
  e.handle('hunter-clash-create');assert.match(e.render(),/disabled>建立挑戰/);
});
test('joining requests camera once, rerender reattaches, back stops tracks',async()=>{
  let calls=0,stops=0;const stream={getTracks:()=>[{stop:()=>stops++}]};
  const e=entry({media:()=>({getUserMedia:async()=>{calls++;return stream;}})});e.session(actor('a'),{active:true});await flush();e.handle('hunter-clash-join');
  const r=root();e.bind(r,true);await flush();assert.equal(calls,1);assert.equal(r.video.srcObject,stream);
  e.bind(root(),true);assert.equal(calls,1);assert.match(e.render(),/maxlength="4"/);
  e.handle('hunter-clash-back');assert.equal(stops,1);
});
test('late permission result releases tracks after tab exit',async()=>{
  let resolve,stops=0;const e=entry({media:()=>({getUserMedia:()=>new Promise(r=>resolve=r)})});e.session(actor('a'),{active:true});await flush();e.handle('hunter-clash-join');e.bind(root(),true);
  e.bind(root(),false);resolve({getTracks:()=>[{stop:()=>stops++}]});await flush();assert.equal(stops,1);
});
test('permission denial keeps four-code fallback and retries only on explicit tap',async()=>{
  let calls=0;const e=entry({media:()=>({getUserMedia:async()=>{calls++;throw Object.assign(Error(),{name:'NotAllowedError'});}})});e.session(actor('a'),{active:true});await flush();e.handle('hunter-clash-join');const r=root();e.bind(r,true);await flush();e.bind(root(),true);await flush();assert.equal(calls,1);assert.match(r.status.textContent,/未獲授權/);assert.match(e.render(),/四碼配對序號/);
  e.handle('hunter-clash-camera');e.bind(root(),true);await flush();assert.equal(calls,2);
});
test('background and account switches stop camera; no PK network or award path exists',async()=>{
  let stops=0;const e=entry({media:()=>({getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})})});e.session(actor('a'),{active:true});await flush();e.handle('hunter-clash-join');e.bind(root(),true);await flush();e.suspend();assert.equal(stops,1);
  e.session(actor('b'),{active:true});await flush();assert.doesNotMatch(e.render(),/data-hc-camera/);
  assert.doesNotMatch(source,/fetch\(|getIdToken\(|signIn|initializeApp|hunterBuildGrowth|syncHunterAchievements/);
});
