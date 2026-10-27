'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const c=vm.createContext({window:{},setTimeout,Date});vm.runInContext(fs.readFileSync('modules/main-app/hunter-leaderboard.js','utf8'),c);return c.window.BXHHunterLeaderboard;}
const row=(key='a')=>({key,playerName:'<img src=x onerror=alert(1)>',tier:'b',rank:1,score:60,strength:58,replayedHighest:'a'});
const page=(n=1,extra={})=>({ok:true,version:'hunter-leaderboard-v1',promotionPolicy:'medium-or-larger-v1',status:'complete',generation:'g1793000000000-abcdefabcdef',page:n,pageSize:50,total:1,hasMore:false,rows:[row()],mine:null,counts:{eligible:1,ranked:1,pending:0,noHistory:0,notPublic:0},updatedAt:2000,startedAt:1000,highest:{tier:'b'},...extra});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('render escapes names, reports coverage and distinguishes current from replayed highest',async()=>{
 const V=setup(),v=V.create({load:async()=>page(),identity:()=>'',onChange:()=>{}});await v.refresh();const h=v.render(esc);
 assert(h.includes('&lt;img'));assert(!h.includes('<img src=x'));assert(h.includes('生涯最高（回算）'));assert(h.includes('最高階級'));assert(h.includes('登入後查看'));assert(h.includes('60.0'));
});
test('incomplete scans never claim a global highest and service failures do not become an empty zero board',async()=>{
 const V=setup(),v=V.create({load:async()=>page(1,{status:'partial',counts:{eligible:2,ranked:1,pending:1,noHistory:0,notPublic:0}}),identity:()=>'',onChange:()=>{}});
 await v.refresh();assert(v.render(esc).includes('不能據此宣告全服最高'));
 const bad=V.create({load:async()=>{throw Error('offline');},identity:()=>'',onChange:()=>{}});await bad.refresh();assert(bad.render(esc).includes('role="alert"'));assert(!bad.render(esc).includes('本次尚無可列榜資料'));
});
test('login changes discard late own-rank responses and issue a separate request',async()=>{
 let uid='first',release;const V=setup(),v=V.create({load:()=>new Promise(r=>release=r),identity:()=>uid,onChange:()=>{}});
 const old=v.refresh();uid='second';v.state();release(page(1,{mine:row('first')}));await old;assert.equal(v.state().data,null);assert.equal(v.state().uid,'second');
});
test('pagination stays on one generation and retries the same failed page without duplicates',async()=>{
 const calls=[];let fail=true;const V=setup(),v=V.create({identity:()=>'',onChange:()=>{},load:async q=>{
  calls.push(q);if(q.page===1)return page(1,{total:51,hasMore:true,counts:{eligible:51,ranked:51,pending:0,noHistory:0,notPublic:0}});
  if(fail){fail=false;throw Error('network');}return page(2,{rows:[row('last')],total:51,counts:{eligible:51,ranked:51,pending:0,noHistory:0,notPublic:0}});
 }});await v.refresh();await v.more();assert.equal(v.state().page,1);await v.more();assert.equal(v.state().rows.length,2);
 assert.equal(calls[1].generation,calls[2].generation);assert.equal(calls[1].page,2);
});
test('loader rejects wrong rule versions, malformed rows and mixed generations',()=>{
 const V=setup();for(const extra of [{promotionPolicy:'old'},{rows:[{...row(),score:NaN}]},{rows:[{...row(),rank:0}]},{total:-1}])assert.equal(V.validPage(page(1,extra),1),false);
 assert.equal(V.validPage(page(),1,'different-generation'),false);
 const html=fs.readFileSync('index.html','utf8');assert(html.indexOf('hunter-leaderboard.js')<html.indexOf('modules/main-app/core.js'));
 const core=fs.readFileSync('modules/main-app/hunter-leaderboard-integration.js','utf8');assert(core.includes("view==='hunter'"));assert(core.includes("data-action=\"ranking-board\""));
});
