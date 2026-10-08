'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function setup(){
 const c=vm.createContext({window:{},console,setTimeout:()=>{}});
 for(const name of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+name+'.js','utf8'),c);
 Object.assign(c,c.window.BXHHunterUtils,{HUNTER_ANALYSIS_TYPES:['extreme','knockout','burst','spin'],HUNTER_ANALYSIS_LABELS:{extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'},HUNTER_ANALYSIS_MIN_MATCHES:3,HUNTER_ANALYSIS_MIN_ROUNDS:8,HUNTER_H2H_ANALYSIS_MIN_MATCHES:3,HUNTER_H2H_ANALYSIS_MIN_ROUNDS:8,esc:String,hunterBattleFilter:'standard',hunterRecordTypeFilter:'all',hunterRecordPeriodFilter:'career',hunterPeriodStartMs:()=>100});
 for(const name of ['hunterModeLabel','hunterBattleFiltersHtml','hunterEnchantmentSummaryHtml','hunterFilteredRecords','hunterRecordsForPeriod','hunterBuildAnalysis','hunterBuildOpponentAnalysis','hunterSingleMatchBreakdown','hunterSingleMatchBreakdownHtml','hunterRecordTimelineHtml','renderPlayerStatsTab']){
  const a=core.indexOf('function '+name+'(');let b=core.indexOf('\nfunction ',a+1);
  if(name==='hunterFilteredRecords')b=core.indexOf('\nconst {',a);
  vm.runInContext(core.slice(a,b),c);
 }
 return c;
}
function standard(i=1){return {eventCode:'B2',matchId:'m'+i,completedAt:200,scoringVersion:'bxh-4pt-v1',analyzable:true,isWin:true,scoreFor:4,scoreAgainst:1,roundsPerspective:[{eventId:'a',type:'burst',points:2,perspective:'for'},{eventId:'b',type:'knockout',points:2,perspective:'for'},{eventId:'c',type:'spin',points:1,perspective:'against'}]};}
function enchanted(i=1){return {...standard(i),matchId:'e'+i,scoringVersion:'bxh-enchantment-v2',scoreFor:5,scoreAgainst:0,roundsPerspective:[{eventId:'a',v:2,type:'burst',basePoints:2,points:3,delta:1,perspective:'for'},{eventId:'b',v:2,type:'spin',basePoints:1,points:1,delta:0,perspective:'for'},{eventId:'c',v:2,type:'spin',basePoints:1,points:0,delta:-1,perspective:'against'},{eventId:'d',v:2,type:'fault',basePoints:1,points:1,delta:0,perspective:'for'}]};}
test('canonical source partitions preserve latest correction and reject unknown versions',()=>{
 const c=setup(),rows=[standard(),enchanted(),{...standard(2),sourceType:'hunter-clash'},{...standard(3),scoringVersion:'future-v9'}];
 assert.equal(c.hunterFilterByMode(rows,'all').length,4);
 for(const mode of ['standard','enchantment','pk'])assert.equal(c.hunterFilterByMode(rows,mode).length,1);
 assert.equal(c.hunterRecordMode({...standard(),playMode:'enchantment'}),'unknown');
 assert.equal(c.hunterRecordMode({...enchanted(),scoringVersion:null}),'unknown');
 assert.equal(c.hunterRecordMode({...standard(),scoringVersion:null}),'standard');
 const corrected={...enchanted(),matchId:'m1',confirmedAt:500};
 assert.equal(c.hunterFilterByMode([standard(),corrected],'standard').length,0);
});
test('enchantment splits base, bonus, reduction and fault and reconciles the official result',()=>{
 const c=setup(),s=c.hunterScoringBreakdown(enchanted());
 assert.equal(s.baseFor,3);assert.equal(s.gainFor,1);assert.equal(s.faultFor,1);assert.equal(s.actualFor,5);
 assert.equal(s.baseAgainst,1);assert.equal(s.reductionAgainst,1);assert.equal(s.actualAgainst,0);
 for(const side of ['For','Against'])assert.equal(s['base'+side]+s['gain'+side]-s['reduction'+side]+s['fault'+side],s['actual'+side]);
 const sum=c.hunterModeSummary([enchanted(),enchanted(),enchanted(2)]);
 assert.equal(sum.enchantmentVerified,2);assert.equal(sum.totals.actualFor,10);
});
test('missing or inconsistent v2 base data is excluded from every ability path and never guessed',()=>{
 const c=setup();
 for(const key of ['basePoints','delta','v']){
  const r=enchanted();delete r.roundsPerspective[0][key];
  assert.equal(c.hunterScoringBreakdown(r).available,false);
  assert.equal(c.hunterBuildAnalysis([r]).matches,0);assert.equal(c.hunterBuildOpponentAnalysis([r]).analyzableMatches,0);
  assert.match(c.hunterSingleMatchBreakdownHtml(r),/不顯示部分攻防拆解/);
  assert.equal(c.hunterCoverage([r],[]).reasons['enchantment-breakdown-missing'],1);
 }
 const r=enchanted();r.roundsPerspective[0].basePoints=3;assert.equal(c.hunterScoringBreakdown(r).available,false);
});
test('card adjustments never inflate base attack, evidence, head-to-head or ability scores',()=>{
 const c=setup(),rows=[1,2,3].map(enchanted),a=c.hunterBuildAnalysis(rows),h=c.hunterBuildOpponentAnalysis(rows);
 assert.equal(a.totalFor,9);assert.equal(a.totalAgainst,3);assert.equal(a.pointEfficiency,75);assert.equal(a.validRounds,9);
 assert.equal(a.overall,null);assert.equal(a.eligible,false);assert.equal(a.distributionEligible,true);
 assert.equal(h.totalFor,9);assert.equal(h.totalAgainst,3);assert.equal(c.hunterSingleMatchBreakdown(rows[0]).attack.burst.points,2);
 assert.equal(a.attack.burst.evidence[0].analysisPoints,2);assert.equal(a.attack.burst.evidence[0].points,3);
 assert.equal(c.hunterBuildAnalysis([1,2,3].map(standard)).overall,92);
 assert.equal(c.hunterBuildAnalysis([...rows,...[1,2,3].map(standard)]).overall,null);
 assert.equal(c.hunterBuildOpponentAnalysis([...rows,...[1,2,3].map(standard)]).eligible,false);
});
test('category, ladder and period filters compose without resurrecting old records',()=>{
 const c=setup();c.hunterProfileCache={records:[standard(),{...standard(2),ladderMode:'ranked'},enchanted(),{...enchanted(2),completedAt:50}]};
 c.hunterBattleFilter='enchantment';assert.equal(c.hunterRecordsForPeriod('career').length,2);assert.equal(c.hunterRecordsForPeriod('today').length,1);
 c.hunterBattleFilter='standard';c.hunterRecordTypeFilter='ranked';assert.equal(c.hunterFilteredRecords().length,1);
 c.hunterBattleFilter='all';c.hunterRecordTypeFilter='all';assert.equal(c.hunterFilteredRecords().length,4);
});
test('PK is disabled honestly and split presentation identifies additive arithmetic',()=>{
 const c=setup(),html=c.hunterBattleFiltersHtml();assert.match(html,/disabled[^>]*>PK（尚未串接）/);assert.doesNotMatch(html,/data-value="pk"/);
 const split=c.hunterEnchantmentSummaryHtml([enchanted()]);for(const text of ['基礎分','卡牌加分','卡牌減分','失誤判罰','實際比分'])assert.ok(split.includes(text));
 const broken=enchanted();delete broken.roundsPerspective[0].basePoints;assert.match(c.hunterEnchantmentSummaryHtml([broken]),/未猜測基礎分/);
 const timeline=c.hunterRecordTimelineHtml(enchanted());assert.match(timeline,/基礎 2，卡牌 \+1/);assert.match(timeline,/基礎 1，卡牌 -1/);
});
test('license uses standard records while XP continues to include all connected modes',()=>{
 const c=setup(),rows=[1,2,3].map(standard),mixed=[...rows,...[1,2,3].map(enchanted)];
 const original=c.hunterLicenseGrade(c.hunterBuildAnalysis(rows),c.hunterBuildGrowth(rows).level);
 const isolated=c.hunterBuildAnalysis(c.hunterFilterByMode(mixed,'standard'));
 assert.equal(isolated.overall,92);assert.equal(isolated.matches,3);assert.ok(c.hunterBuildGrowth(mixed).xp>c.hunterBuildGrowth(rows).xp);
 assert.equal(c.hunterLicenseGrade(isolated,c.hunterBuildGrowth(rows).level).score,original.score);
 assert.match(core,/const careerAnalysis=hunterBuildAnalysis\(hunterFilterByMode\(allRecords,"standard"\)\);/);
 // Exercise the actual click handler with its real target contract.
 const a=core.indexOf('  if(action==="hunter-battle-filter")'),b=core.indexOf('  if(action==="hunter-overview-period")',a);
 c.target={getAttribute:()=> 'enchantment'};c.renderPreservingScroll=()=>c.rendered=true;c.action='hunter-battle-filter';
 vm.runInContext('(function(){'+core.slice(a,b)+'})()',c);assert.equal(c.hunterBattleFilter,'enchantment');assert.equal(c.rendered,true);
 c.target={getAttribute:()=> 'pk'};vm.runInContext('(function(){'+core.slice(a,b)+'})()',c);assert.equal(c.hunterBattleFilter,'enchantment');
});
