'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
function setup(){
 const ctx=vm.createContext({window:{},console,setTimeout:()=>{}});
 vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app/domain-utils.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(root,'modules/main-app/hunter-utils.js'),'utf8'),ctx);
 Object.assign(ctx,ctx.window.BXHHunterUtils);
 ctx.HUNTER_ANALYSIS_TYPES=['extreme','knockout','burst','spin'];
 ctx.HUNTER_ANALYSIS_LABELS={extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'};
 ctx.HUNTER_ANALYSIS_MIN_MATCHES=3;ctx.HUNTER_ANALYSIS_MIN_ROUNDS=8;
 ctx.HUNTER_H2H_ANALYSIS_MIN_MATCHES=3;ctx.HUNTER_H2H_ANALYSIS_MIN_ROUNDS=8;
 for(const name of ['hunterModeLabel','hunterBattleFiltersHtml','hunterEnchantmentSummaryHtml','hunterBuildAnalysis','hunterBuildOpponentAnalysis','hunterAnalysisStatHtml','renderPlayerStatsTab']){
  const start=core.indexOf('function '+name+'(');const end=core.indexOf('\nfunction ',start+1);
  vm.runInContext(core.slice(start,end),ctx);
 }
 return ctx;
}
function record(overrides={}){return {eventCode:'BXH-TEST',matchId:'m1',completedAt:10,analyzable:true,isWin:true,scoreFor:4,scoreAgainst:1,roundsPerspective:[
 {eventId:'1',type:'burst',perspective:'for',points:2},
 {eventId:'2',type:'knockout',perspective:'for',points:2},
 {eventId:'3',type:'spin',perspective:'against',points:1}
 ],...overrides};}
test('latest correction replaces the older match regardless of source order; reversal removes it',()=>{
 const c=setup(),old=record(),corrected=record({confirmedAt:20,isWin:false});
 for(const rows of [[old,corrected],[corrected,old]]){assert.equal(c.hunterCareerSummary(rows).matches,1);assert.equal(c.hunterCareerSummary(rows).wins,0);}
 const revoked=record({updatedAt:30,completed:false});
 assert.equal(c.hunterUniqueRecords([old,revoked]).length,0);
 assert.equal(c.hunterBuildGrowth([old,revoked]).xp,0);
});
test('summary, XP, ability and head-to-head share trusted finish-round count; penalties reconcile only',()=>{
 const c=setup(),r=record({scoreFor:5,roundsPerspective:[...record().roundsPerspective,{eventId:'4',type:'fault',perspective:'for',points:1}]});
 for(const rows of [[r],[r,r]]){
  assert.equal(c.hunterCareerSummary(rows).validRounds,3);
  assert.equal(c.hunterBuildGrowth(rows).validRounds,3);
  assert.equal(c.hunterBuildAnalysis(rows).validRounds,3);
  assert.equal(c.hunterBuildOpponentAnalysis(rows).validRounds,3);
  assert.equal(c.hunterBuildGrowth(rows).xp,38); // Existing fault-event XP is preserved.
  assert.equal(c.hunterBuildAnalysis(rows).totalFor,4);
 }
});
test('mismatched and duplicate ledger events cannot inflate ability statistics',()=>{
 const c=setup();
 for(const r of [record({scoreFor:7}),record({roundsPerspective:[...record().roundsPerspective,record().roundsPerspective[0]],scoreFor:6})]){
  assert.equal(c.hunterBuildAnalysis([r]).matches,0);
  assert.equal(c.hunterBuildGrowth([r]).validRounds,0);
  assert.equal(c.hunterRecordHasTrustedScore(r),false);
 }
});
test('quick decisions keep victory and match XP without fabricating scores or rounds',()=>{
 const c=setup(),r=record({resultMethod:'quick_decision',analyzable:false,scoreFor:null,scoreAgainst:null,roundsPerspective:[]});
 assert.equal(c.hunterCareerSummary([r]).wins,1);
 assert.equal(c.hunterBuildAnalysis([r]).matches,0);
 assert.equal(c.hunterBuildGrowth([r]).xp,30);
 assert.equal(c.hunterCoverage([r],[]).reasons['quick-decision'],1);
});
test('partial registration reads, loading, failure and genuinely empty history are distinct',()=>{
 const c=setup();
 assert.equal(c.hunterDataStatus(null,true,null),'loading');
 assert.equal(c.hunterDataStatus({records:[],skipped:[]},false,'failed'),'error');
 assert.equal(c.hunterDataStatus({records:[],skipped:[]},false,null),'empty');
 assert.equal(c.hunterDataStatus({records:[],skipped:[{reason:'registration-read-failed'}]},false,null),'partial');
});
function render(c,cache,{loading=false,error=null}={}){
 Object.assign(c,{hunterProfileCache:cache,hunterProfileLoading:loading,hunterProfileError:error,
 playerStatsSubTab:'analysis',hunterAnalysisPeriod:'career',hunterBattleFilter:'standard',
 playerDerivedId:()=> 'P123',effectiveGameId:()=>'',esc:x=>String(x),
 hunterRecordsForPeriod:()=>cache?.records||[],hunterSeasonStartMs:()=>0,
 hunterRadarSvg:()=>'<svg></svg>',hunterAnalysisStatHtml:()=>'',
 });
 return c.renderPlayerStatsTab({displayName:'Tester'});
}
test('render does not show zero ability or LV1 while loading or failing; empty percentages are dashes',()=>{
 const c=setup();
 for(const options of [{loading:true},{error:'讀取失敗'}]){
  const html=render(c,{records:[],skipped:[]},options);
  assert(!html.includes('0%'));assert(!html.includes('LV.1'));assert(!html.includes('得分占比'));
  assert(html.includes('暫不顯示統計或評級'));
 }
 const empty=render(c,{records:[],skipped:[]});
 assert(empty.includes('尚無已完成對戰'));assert(empty.includes('得分占比'));assert(!empty.includes('>0%</b>'));
});
test('partial history suppresses conclusions even with enough successful matches',()=>{
 const c=setup(),records=[record(),record({matchId:'m2'}),record({matchId:'m3'})];
 assert.equal(c.hunterBuildAnalysis(records).eligible,true);
 const html=render(c,{records,skipped:[{reason:'registration-read-failed'}]});
 assert(html.includes('本人報名資料讀取失敗'));assert(html.includes('資料尚未完整'));
 assert(!html.includes('樣本達標'));assert(!html.includes('複合均衡型'));
 assert(html.includes('勝率＝可分析勝場／可分析場數'));
});

test('empty finish-stat breakdown uses a dash instead of an invented percentage',()=>{
 const c=setup();c.esc=String;c.hunterEvidenceHtml=()=>'';
 const a=c.hunterBuildAnalysis([]);assert(!c.hunterAnalysisStatHtml(a.attack,'spin').includes('0%'));
});
