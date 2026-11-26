const {test}=require('node:test'),assert=require('node:assert/strict');
require('../modules/main-app/team-leaderboard.js');
const {create,validPage}=globalThis.BXHTeamLeaderboard;
const row={id:'bxh',name:'BXH',captainName:'黑爸',rank:1,strength:511,memberCount:1,level:1};
const page=(offset=0)=>({items:[row],total:21,excluded:1,partial:true,offset,limit:20});
test('ranking preserves backend ranks, pagination and partial notices',async()=>{let scheduled,queries=[];const c=create({identity:()=> 'me',load:async q=>{queries.push(q);return page(q.offset)},onChange(){},schedule:f=>scheduled=f});c.render(String);await scheduled();assert.match(c.render(String),/尚未列榜/);await c.next();assert.equal(c.state().offset,20);await c.previous();assert.deepEqual(queries.map(q=>q.offset),[0,20,0]);assert.match(c.render(String),/第 1 名/);});
test('identity switch discards stale response and clears rows',async()=>{let uid='a',resolve;const c=create({identity:()=>uid,load:()=>new Promise(r=>resolve=r),onChange(){}});const pending=c.refresh();uid='b';c.state();resolve(page());await pending;assert.equal(c.state().data,null);uid=null;assert.match(c.render(String),/請登入/);});
test('failed or malformed response shows retryable error, never fake zero teams',async()=>{const c=create({identity:()=> 'me',load:async()=>({items:[]}),onChange(){}});await c.refresh();assert.match(c.render(String),/暫時無法讀取/);assert.doesNotMatch(c.render(String),/沒有可列榜/);assert.equal(validPage({...page(),items:[{...row,rank:0}]},0),false);});
test('top ten name colors match ladder categories; lower ranks keep default',()=>{const {rankClass}=globalThis.BXHTeamLeaderboard;assert.deepEqual([1,2,3,4,5,10,11].map(rankClass),['team-name-rank-1','team-name-rank-2','team-name-rank-3','team-name-rank-4','team-name-rank-elite','team-name-rank-elite','']);});
test('previous published generation is identified with Taiwan time while teams update',async()=>{const c=create({identity:()=> 'me',load:async()=>({...page(),updating:true,snapshotAt:Date.UTC(2026,10,22,6,37),excluded:0}),onChange(){}});await c.refresh();const html=c.render(String);assert.match(html,/戰隊榜資料更新中/);assert.match(html,/11\/22/);assert.match(html,/14:37/);assert.doesNotMatch(html,/0 支尚未列榜/);});
test('members are read only after expansion and cache is discarded across identity changes',async()=>{let uid='me',calls=0,resolve;const c=create({identity:()=>uid,load:async()=>page(),loadMembers:()=>{calls++;return new Promise(r=>resolve=r);},onChange(){}});await c.refresh();assert.equal(calls,0);const p=c.expand('bxh');assert.equal(calls,1);uid='other';c.state();resolve({id:'bxh',members:[{name:'old-member'}]});await p;assert.equal(c.state().members.bxh,undefined);await c.refresh();const q=c.expand('bxh');resolve({id:'bxh',members:[{name:'safe-name',private:'SECRET'}]});await q;assert.deepEqual(c.state().members.bxh.items,[{name:'safe-name'}]);await c.expand('bxh',false);await c.expand('bxh');assert.equal(calls,2);});

test('returning to the ranking tab coalesces ordinary background refresh and preserves reading position',()=>{
 const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
 const handlers={},calls=[];
 let now=1000;
 const state={data:page(),loading:false,offset:0,expanded:new Set()};
 const document={hidden:false,addEventListener:(name,fn)=>handlers[name]=fn,querySelector:()=>({})};
 const window={BXH_TEAM_FULL_ENABLED:true,BXHHunterLeaderboard:{},BXHTeamLeaderboard:{create:()=>({state:()=>state,render:()=>'',refresh:()=>calls.push('refresh')})}};
 const ctx=vm.createContext({window,document,currentAuthUid:()=> 'fixture',userProfile:{active:true,role:'player'},appPhase:'app',activeTab:'ladder',renderPreservingScroll(){},renderLadderLeaderboardPage:()=>'',esc:String,Date:{now:()=>now}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules/main-app/hunter-leaderboard-integration.js'),'utf8'),ctx);
 handlers.click({target:{closest:()=>({getAttribute:key=>key==='data-action'?'ranking-board':'team'})},preventDefault(){},stopImmediatePropagation(){}});
 ctx.renderLadderLeaderboardPage(false);
 function away(ms){document.hidden=true;handlers.visibilitychange();now+=ms;document.hidden=false;handlers.visibilitychange();}
 away(1000);assert.equal(calls.length,0);
 away(31000);assert.equal(calls.length,1);
 handlers.visibilitychange();assert.equal(calls.length,1);
 state.offset=20;away(31000);assert.equal(calls.length,1);
 state.offset=0;state.expanded.add('bxh');away(31000);assert.equal(calls.length,1);
 state.expanded.clear();state.loading=true;away(31000);assert.equal(calls.length,1);
 state.loading=false;ctx.activeTab='other';away(31000);assert.equal(calls.length,1);
});
