'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../modules/main-app/ladder-team-display.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('renders only a real team, escapes name, and invalidates membership on refresh',async()=>{
 let team=null,calls=0;const snapshot={},player={uid:'p'};
 const ui=create({identity:()=> 'p',onChange(){},read:async p=>{calls++;return {ok:true,version:1,teams:{p:team}};}});
 ui.ensure(snapshot,[player]);await tick();assert.equal(ui.lineHtml(snapshot,'p'),'');
 team={name:'<BXH>🐢'};ui.ensure(snapshot,[player]);await tick();assert.equal(calls,1);
 ui.invalidate();ui.ensure(snapshot,[player]);await tick();assert.match(ui.lineHtml(snapshot,'p'),/（&lt;BXH&gt;🐢）/);
 team=null;ui.invalidate();ui.ensure(snapshot,[player]);await tick();assert.equal(ui.lineHtml(snapshot,'p'),'');
});
test('late batch cannot resurrect hidden team after preference changes',async()=>{
 let resolve;const snapshot={},ui=create({identity:()=> 'p',onChange(){},read:()=>new Promise(r=>{resolve=r;})});
 ui.ensure(snapshot,[{uid:'p'}]);await tick();ui.invalidate();resolve({ok:true,version:1,teams:{p:{name:'OLD'}}});await tick();assert.equal(ui.lineHtml(snapshot,'p'),'');
});
test('bounded requests, no duplicate reads on rerender, and failure stays collapsed',async()=>{
 const sizes=[],snapshot={},rows=Array.from({length:123},(_,i)=>({uid:'p'+i}));
 const ui=create({identity:()=> 'p',onChange(){},read:async p=>{sizes.push(p.uids.length);throw Error('offline');}});
 ui.ensure(snapshot,rows);ui.ensure(snapshot,rows);await tick();assert.deepEqual(sizes,[50,50,23]);assert.equal(ui.lineHtml(snapshot,'p1'),'');
});
test('saved off survives UI reload, and switching accounts drops stale preference response',async()=>{
 let uid='p',stored=true,pending=null;
 const ui=create({identity:()=>uid,onChange(){},read:async p=>{if(pending)return pending;if(p.action==='save')stored=p.showTeam;return {ok:true,showTeam:stored};}});
 ui.preferenceHtml();await tick();await ui.savePreference(false);assert.doesNotMatch(ui.preferenceHtml(),/data-ladder-team-display checked/);
 await ui.loadPreference();assert.doesNotMatch(ui.preferenceHtml(),/data-ladder-team-display checked/);
 let resolve;pending=new Promise(r=>{resolve=r;});const old=ui.loadPreference();uid='q';ui.preferenceHtml();resolve({ok:true,showTeam:false});await old;await tick();assert.match(ui.preferenceHtml(),/data-ladder-team-display/);
});
test('unconfirmed save requires re-read and does not claim success',async()=>{
 const ui=create({identity:()=> 'p',onChange(){},read:async p=>{if(p.action==='save')throw Error('timeout');return {ok:true,showTeam:true};}});
 await ui.loadPreference();await ui.savePreference(false);assert.match(ui.preferenceHtml(),/儲存尚未確認/);assert.match(ui.preferenceHtml(),/data-ladder-team-retry/);
 await ui.loadPreference();assert.match(ui.preferenceHtml(),/data-ladder-team-display checked/);
});
