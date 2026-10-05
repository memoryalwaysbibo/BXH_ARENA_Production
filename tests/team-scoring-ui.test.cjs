'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const cloud=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
const publicWatchPatch=fs.readFileSync(path.join(__dirname,'../modules/main-app/public-watch-isolation.js'),'utf8');


const releaseIndex=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const releaseVersion=JSON.parse(fs.readFileSync(path.join(__dirname,'../version.json'),'utf8'));
assert.equal(releaseVersion.build,'20261005.1');
assert.equal(releaseVersion.version,'v14.3.24');
assert(releaseIndex.includes('<meta name="bxh-build" content="20261005.1">'));
assert(releaseIndex.includes('var CURRENT_BUILD="20261005.1";'));
assert(releaseIndex.includes('public-watch-isolation.js?v=20261005-watch-spa-1'));
assert(source.includes('雙命守擂計分板｜'));
assert(source.includes("'●'.repeat(life)+'○'.repeat(Math.max(0,2-life))"));
assert(source.includes("if(view.revealed&&state.startedAt){"));
assert(!source.includes("if(view.revealed&&state.startedAt&&view.isReferee===true){"));
assert(source.includes("'lineups-incomplete':'雙方尚未完成排陣"));
assert(source.includes('data-action="team-score-direct"'));
assert(source.includes('data-action="team-lineup-default"'));
assert(source.includes("action:'default',code,matchId,teamId:team.id"));
assert(source.includes("view?.defaulted?.[t.id]"));
assert(source.includes("'lineup-already-submitted':'該隊已提交排陣"));
assert(source.includes('data-winner-side="'));
assert(source.includes("[['spin','轉停'],['burst','爆裂'],['over','擊飛'],['extreme','極限']]"));
assert(!source.includes('id="team-score-winner-'));
assert(source.includes('function renderTeamReferee()'));
assert(source.includes('if(mine&&!refereeMode){'));
assert(publicWatchPatch.includes("new URLSearchParams(location.search).get('entry')==='watch'"));
assert(publicWatchPatch.includes("if(inPublicWatch()&&mode!=='referee')return '';"));
assert(publicWatchPatch.includes('return originalLineupPanel(m,mode);'));
assert(publicWatchPatch.includes("activeTab==='referee'&&!inPublicWatch()"));
assert(publicWatchPatch.includes("const allowedTabs=new Set(['ladder','live','bracket'])"));
assert(publicWatchPatch.includes("v2.dataset.visibleTabs='ladder,live,bracket'"));
assert(publicWatchPatch.includes("node.textContent='目前為公開觀賽模式'"));
assert(source.includes("if(state.meta?.battleMode===\"team\")return renderTeamReferee();"));
assert(source.includes('data-action="set-team-bracket-view"'));
assert(source.includes("teamBracketViewMode==='live'?renderTeamMatchList(false):renderTeamTree()"));
assert(source.includes('function renderTeamTree()'));
assert(cloud.includes('subscribeTeamLive(code, callback)'));

function watchIsolationCase(search,watchContext,activeTab){
  const makeNode=(data={})=>({dataset:data,removed:false,cleared:false,remove(){this.removed=true;},replaceChildren(){this.cleared=true;}});
  const nav=['ladder','live','bracket','duty','operations','history','version'].map(tab=>makeNode({tab}));
  const account=['back-from-public-watch','account-logout','admin-open'].map(action=>makeNode({action}));
  const modeContext=makeNode();
  const navRoot={dataset:{}};
  const app={
    querySelectorAll(selector){
      if(selector==='[data-action="switch-tab"][data-tab]')return nav;
      if(selector==='.mode-management-context')return [modeContext];
      if(selector==='.public-watch-return [data-action="cloud-admin-open-tournament"]')return [];
      if(selector==='.public-watch-return span'||selector==='.account-role-label')return [];
      if(selector==='.account-menu button')return account;
      return [];
    },
    querySelector(selector){return selector==='#bxh-management-v2-nav'?navRoot:null;}
  };
  let originalRendered=false,originalPrimeCount=0;
  const currentLocation={search};
  const sandbox={
    URLSearchParams,location:currentLocation,publicWatchReturnContext:watchContext,activeTab,
    renderTeamLineupPanel:()=> 'lineup',primeTeamMatchViews(){originalPrimeCount++;},
    renderApp(){originalRendered=true;},document:{getElementById:()=>app}
  };
  vm.runInNewContext(publicWatchPatch,sandbox);
  sandbox.renderApp();
  return {sandbox,nav,account,modeContext,navRoot,originalRendered:()=>originalRendered,originalPrimeCount:()=>originalPrimeCount,setSearch:(value)=>{currentLocation.search=value;}};
}
const directWatch=watchIsolationCase('?code=BXH-QATEST&entry=watch',false,'duty');
assert.equal(directWatch.sandbox.activeTab,'live');
assert.deepEqual(directWatch.nav.filter(x=>!x.removed).map(x=>x.dataset.tab),['ladder','live','bracket']);
assert.deepEqual(directWatch.account.filter(x=>!x.removed).map(x=>x.dataset.action),['back-from-public-watch','account-logout']);
assert.equal(directWatch.navRoot.dataset.visibleTabs,'ladder,live,bracket');
assert.equal(directWatch.modeContext.cleared,true);
assert.equal(directWatch.originalRendered(),true);
assert.equal(directWatch.sandbox.renderTeamLineupPanel({},'player'),'');
const normalEvent=watchIsolationCase('?code=BXH-QATEST&entry=event',false,'duty');
assert.equal(normalEvent.sandbox.activeTab,'duty');
assert.equal(normalEvent.nav.some(x=>x.removed),false);
const transitionedWatch=watchIsolationCase('?code=BXH-QATEST&entry=event',false,'duty');
transitionedWatch.setSearch('?code=BXH-QATEST&entry=watch');
transitionedWatch.sandbox.renderApp();
assert.equal(transitionedWatch.sandbox.activeTab,'live');
assert.deepEqual(transitionedWatch.nav.filter(x=>!x.removed).map(x=>x.dataset.tab),['ladder','live','bracket']);
assert.equal(transitionedWatch.sandbox.renderTeamLineupPanel({},'player'),'');

console.log('PASS team scoring board and direct public-watch role isolation contracts');
