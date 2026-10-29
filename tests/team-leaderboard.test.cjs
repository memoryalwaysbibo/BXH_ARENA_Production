const {test}=require('node:test'),assert=require('node:assert/strict');
require('../modules/main-app/team-leaderboard.js');
const {create,validPage}=globalThis.BXHTeamLeaderboard;
const row={id:'bxh',name:'BXH',captainName:'黑爸',rank:1,strength:511,memberCount:1,level:1};
const page=(offset=0)=>({items:[row],total:21,excluded:1,partial:true,offset,limit:20});
test('ranking preserves backend ranks, pagination and partial notices',async()=>{let scheduled,queries=[];const c=create({identity:()=> 'me',load:async q=>{queries.push(q);return page(q.offset)},onChange(){},schedule:f=>scheduled=f});c.render(String);await scheduled();assert.match(c.render(String),/尚未列榜/);await c.next();assert.equal(c.state().offset,20);await c.previous();assert.deepEqual(queries.map(q=>q.offset),[0,20,0]);assert.match(c.render(String),/第 1 名/);});
test('identity switch discards stale response and clears rows',async()=>{let uid='a',resolve;const c=create({identity:()=>uid,load:()=>new Promise(r=>resolve=r),onChange(){}});const pending=c.refresh();uid='b';c.state();resolve(page());await pending;assert.equal(c.state().data,null);uid=null;assert.match(c.render(String),/請登入/);});
test('failed or malformed response shows retryable error, never fake zero teams',async()=>{const c=create({identity:()=> 'me',load:async()=>({items:[]}),onChange(){}});await c.refresh();assert.match(c.render(String),/暫時無法讀取/);assert.doesNotMatch(c.render(String),/沒有可列榜/);assert.equal(validPage({...page(),items:[{...row,rank:0}]},0),false);});
