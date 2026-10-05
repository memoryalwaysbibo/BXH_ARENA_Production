'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ui=fs.readFileSync(path.join(__dirname,'../ladder-secondary-ui.js'),'utf8');
const runtime=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function context(read){
  const ctx=vm.createContext({
    window:{cloudSync:{getLadderTransactions:read}},
    document:{addEventListener(){},createElement(){return {};},head:{appendChild(){}}},
    renderLadderLeaderboardPage(){return '';},render(){},
    console:{warn(){}},Intl,Date,Promise,
    ladderPublicLoaded:false,ladderPublicError:'',ladderPublicData:{control:{currentSeason:'S1'},players:[]},
    firebaseUser:null,userProfile:null,ladderAdminLogs:[],ladderAdminLogsLoaded:false,engagementSessionEpoch:0,
  });
  vm.runInContext('function isAdminTierOrAbove(){return !!(userProfile&&userProfile.active!==false&&["admin","super_admin"].includes(userProfile.role));}',ctx);
  vm.runInContext(ui.replace(/\}\)\(\);\s*$/, 'window.testUI={ensureHistory,historyTableHtml,ladderRankingTableHtml};})();'),ctx);
  return ctx;
}

test('unloaded and failed rankings never claim that no points exist',()=>{
  const c=context(async()=>[]),api=c.window.testUI;
  assert.match(api.ladderRankingTableHtml(false),/正在讀取天梯資料/);
  assert.doesNotMatch(api.ladderRankingTableHtml(false),/尚無玩家|尚未上榜/);
  c.ladderPublicError='天梯資料讀取逾時';
  assert.match(api.ladderRankingTableHtml(false),/讀取逾時/);
  c.ladderPublicLoaded=true;c.ladderPublicError='';
  assert.match(api.ladderRankingTableHtml(false),/尚無玩家取得賽季積分/);
});

test('guests see a sign-in message and make no audit queries',()=>{
  let calls=0;const c=context(async()=>{calls++;return [];});
  c.window.testUI.ensureHistory(false);
  assert.equal(calls,0);
  assert.match(c.window.testUI.historyTableHtml(false),/登入玩家帳號/);
  assert.doesNotMatch(c.window.testUI.historyTableHtml(false),/目前沒有積分紀錄/);
});

test('history failures stop rendering retries; explicit refresh retries once',async()=>{
  let calls=0;const c=context(async()=>{calls++;throw Object.assign(new Error('denied'),{code:'permission-denied'});});
  c.firebaseUser={uid:'p1'};
  c.render=()=>c.window.testUI.ensureHistory(false);
  c.window.testUI.ensureHistory(false);await flush();
  assert.equal(calls,1);
  for(let n=0;n<5;n++) c.window.testUI.ensureHistory(false);
  assert.equal(calls,1);
  assert.match(c.window.testUI.historyTableHtml(false),/重新登入/);
  assert.doesNotMatch(c.window.testUI.historyTableHtml(false),/讀取中…|目前沒有積分紀錄/);
  c.window.testUI.ensureHistory(true);await flush();assert.equal(calls,2);
});

test('a late response cannot expose the previous account or admin audit cache',async()=>{
  let finish;const c=context(()=>new Promise(resolve=>{finish=resolve;}));
  c.firebaseUser={uid:'admin1'};c.userProfile={role:'admin'};
  c.window.testUI.ensureHistory(false);await flush();
  c.firebaseUser=null;c.userProfile=null;c.window.testUI.ensureHistory(false);
  finish([{seasonId:'S1',playerName:'PRIVATE',actorName:'ADMIN'}]);await flush();
  assert.doesNotMatch(c.window.testUI.historyTableHtml(true),/PRIVATE|ADMIN|操作人/);
  assert.equal(c.ladderAdminLogs.length,0);
});

test('role and season changes clear cached rows and load the new scope',async()=>{
  let calls=0;const c=context(async({seasonId})=>{calls++;return [{seasonId,playerName:'p1',delta:10}];});
  c.firebaseUser={uid:'p1'};c.window.testUI.ensureHistory(false);await flush();
  assert.match(c.window.testUI.historyTableHtml(false),/p1/);
  c.userProfile={role:'admin'};c.window.testUI.ensureHistory(false);await flush();
  assert.equal(calls,2);
  c.ladderPublicData.control.currentSeason='S2';c.window.testUI.ensureHistory(false);await flush();
  assert.equal(calls,3);assert.match(c.window.testUI.historyTableHtml(true),/S2/);
});

test('same-UID reauthentication cannot restore a previous session response',async()=>{
  let finish;const c=context(()=>new Promise(resolve=>{finish=resolve;}));
  c.firebaseUser={uid:'p1'};c.window.testUI.ensureHistory(false);await flush();
  c.engagementSessionEpoch++;
  finish([{seasonId:'S1',playerName:'OLD SESSION',delta:10}]);await flush();
  c.window.testUI.ensureHistory(false);
  assert.doesNotMatch(c.window.testUI.historyTableHtml(false),/OLD SESSION/);
});

function cloudContext(){
  let query=null;const records=[];
  const c=vm.createContext({cloudEnabled:true,authHandle:{currentUser:{uid:'p1'}},userProfile:{role:'player'},dbHandle:{},cloudSafeTimestampMs:v=>v,
    fx:{collection:(_db,name)=>name,where:(...v)=>['where',...v],orderBy:(...v)=>['orderBy',...v],limit:n=>['limit',n],query:(...v)=>v,
      getDocs:async q=>{query=q;return {forEach:cb=>records.forEach((v,i)=>cb({id:String(i),data:()=>v}))};}}});
  const start=runtime.indexOf('    async getLadderTransactions('),end=runtime.indexOf('    async getTestLadderRanking(',start);
  vm.runInContext('var api={'+runtime.slice(start,end)+'};',c);
  return {c,records,getQuery:()=>query};
}

test('player queries enforce the authenticated UID and current season without an ordering index',async()=>{
  const {c,records,getQuery}=cloudContext();records.push({createdAt:1},{createdAt:3});
  const result=await c.api.getLadderTransactions({seasonId:'S1',playerUid:'other'});
  const q=JSON.parse(JSON.stringify(getQuery()));
  assert.deepEqual(q,['ladderTransactions',['where','playerUid','==','p1'],['where','seasonId','==','S1'],['limit',200]]);
  assert.equal(result[0].createdAtMs,3);
  await assert.rejects(()=>c.api.getLadderTransactions(),/season-required/);
  c.authHandle.currentUser=null;
  await assert.rejects(()=>c.api.getLadderTransactions({seasonId:'S1'}),/auth-required/);
});

test('admins keep bounded newest-first queries and full player results',async()=>{
  const {c,getQuery}=cloudContext();c.userProfile={role:'super_admin'};
  await c.api.getLadderTransactions();
  assert.deepEqual(JSON.parse(JSON.stringify(getQuery())),['ladderTransactions',['orderBy','createdAt','desc'],['limit',200]]);
});

test('a full unordered player page reports the limit instead of inventing a latest record list',async()=>{
  const {c,records}=cloudContext();for(let n=0;n<200;n++)records.push({createdAt:n});
  await assert.rejects(()=>c.api.getLadderTransactions({seasonId:'S1'}),/history-limit-reached/);
});
