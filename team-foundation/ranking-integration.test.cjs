'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const integration=fs.readFileSync(path.join(__dirname,'../modules/main-app/hunter-leaderboard-integration.js'),'utf8');
const ranking=fs.readFileSync(path.join(__dirname,'team-ranking.js'),'utf8');
function harness(preview){
 let listener,uid='player',rerenders=0;const operations=[];
 const window={BXH_TEAM_PREVIEW:preview,BXHHunterLeaderboard:{create:()=>({render:()=>'<hunter/>',refresh(){},more(){}})},engagementService:{tournamentOperation:async (name,payload)=>{operations.push({name,payload});return {items:[{rank:1,name:'戰隊 A',captainName:'隊長',memberCount:2,strength:100}],total:1,excluded:0};}}};
 const scope={window,document:{addEventListener:(name,callback,capture)=>{assert.equal(name,'click');assert.equal(capture,true);listener=callback;}},renderLadderLeaderboardPage:()=>'<ladder/>',currentAuthUid:()=>uid,renderPreservingScroll:()=>{rerenders++;scope.renderLadderLeaderboardPage();},esc:x=>String(x),queueMicrotask};
 vm.createContext(scope);vm.runInContext(ranking,scope);vm.runInContext(integration,scope);
 function click(action,value){let prevented=0,stopped=0;listener({target:{closest:()=>({getAttribute:key=>key==='data-action'?action:value,disabled:false})},preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++});return {prevented,stopped};}
 return {window,scope,click,operations,setUid:value=>{uid=value;},rerenders:()=>rerenders};
}
test('main ranking remains two tabs when preview is disabled',()=>{
 const app=harness(false),html=app.scope.renderLadderLeaderboardPage();assert.match(html,/天梯榜/);assert.match(html,/獵人榜/);assert.doesNotMatch(html,/戰隊榜/);assert.match(html,/<ladder\/>/);
 assert.equal(app.click('ranking-board','team').prevented,1);assert.match(app.scope.renderLadderLeaderboardPage(),/<ladder\/>/);assert.equal(app.operations.length,0);
});
test('main ranking switches to team, calls ranking read once and handles sign-out',async()=>{
 const app=harness(true);assert.match(app.scope.renderLadderLeaderboardPage(),/戰隊榜/);
 assert.deepEqual(app.click('ranking-board','team'),{prevented:1,stopped:1});assert.match(app.scope.renderLadderLeaderboardPage(),/正在載入|戰隊排行/);
 await new Promise(setImmediate);assert.equal(app.operations.length,1);assert.equal(app.operations[0].name,'teamRead');assert.equal(app.operations[0].payload.action,'ranking');
 assert.match(app.scope.renderLadderLeaderboardPage(),/戰隊 A/);app.setUid(null);assert.match(app.scope.renderLadderLeaderboardPage(),/請先登入/);
 assert.ok(app.rerenders()>=2);
});
