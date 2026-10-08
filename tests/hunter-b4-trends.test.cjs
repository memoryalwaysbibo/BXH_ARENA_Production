const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function setup(){
 const c=vm.createContext({window:{},console});
 for(const f of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+f+'.js','utf8'),c);
 Object.assign(c,c.window.BXHHunterUtils,{HUNTER_ANALYSIS_TYPES:['extreme','knockout','burst','spin'],HUNTER_ANALYSIS_LABELS:{extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'},HUNTER_ANALYSIS_MIN_MATCHES:3,HUNTER_ANALYSIS_MIN_ROUNDS:8,esc:String,hunterRadarMetric:'points',hunterBattleFilter:'standard',hunterProfileCache:{loadedAt:1000},hunterPeriodStartMs:()=>0});
 for(const name of ['hunterBuildAnalysis','hunterAnalysisContextHtml','hunterTrendHtml','hunterRecordsForPeriod']){const a=core.indexOf('function '+name+'('),b=core.indexOf('\nfunction ',a+1);vm.runInContext(core.slice(a,b),c);}
 return c;
}
const record=i=>({eventCode:'B4',matchId:'m'+i,completedAt:100000+i,scoringVersion:'bxh-4pt-v1',isWin:i>20,analyzable:true,scoreFor:4,scoreAgainst:1,roundsPerspective:[{type:'burst',points:2,perspective:'for'},{type:'knockout',points:2,perspective:'for'},{type:'spin',points:1,perspective:'against'}]});
const records=n=>Array.from({length:n},(_,i)=>record(i+1));
test('latest 20 and previous 20 are deterministic, disjoint and canonical before sorting',()=>{
 const c=setup(),rows=records(45),w=c.hunterTrendWindows(rows.reverse());assert.equal(w.recent[0].matchId,'m45');assert.equal(w.recent[19].matchId,'m26');assert.equal(w.previous[0].matchId,'m25');assert.equal(w.previous[19].matchId,'m6');assert.equal(w.comparable,true);
 const revoked={...record(45),completed:false,updatedAt:999999};assert.equal(c.hunterTrendWindows([...rows,revoked]).recent[0].matchId,'m44');
 const corrected={...record(44),isWin:false,updatedAt:999999};assert.equal(c.hunterTrendWindows([...rows,corrected]).recent.find(r=>r.matchId==='m44').isWin,false);
});
test('incomplete, undated and cross-version histories never produce comparable deltas',()=>{
 const c=setup();for(const n of [0,3,20,39])assert.equal(c.hunterTrendWindows(records(n)).reason,'insufficient-windows');
 let rows=records(40);rows[0].completedAt=null;assert.equal(c.hunterTrendWindows(rows).reason,'undated');
 rows=records(40);rows[0].scoringVersion='future';assert.equal(c.hunterTrendWindows(rows).reason,'mixed-versions');
 rows=records(40);rows[0].analyzable=false;assert.equal(c.hunterTrendWindows(rows).reason,'incomplete-ledger');
 assert.doesNotMatch(c.hunterTrendHtml(rows),/\+100 個百分點/);assert.match(c.hunterTrendHtml(rows),/不完整回合/);
});
test('partial data override sample maturity and suppress trend change even with 40 complete matches',()=>{
 const c=setup(),rows=records(40),a=c.hunterBuildAnalysis(rows);
 assert.equal(c.hunterSampleMaturity(a,true).state,'partial');assert.match(c.hunterTrendHtml(rows,true),/暫停趨勢結論/);assert.doesNotMatch(c.hunterTrendHtml(rows,true),/\+100 個百分點/);
 assert.match(c.hunterAnalysisContextHtml(a,true),/暫不判定/);
});
test('maturity is preliminary at the existing minimum, never claims calibrated stability',()=>{
 const c=setup();assert.equal(c.hunterSampleMaturity(c.hunterBuildAnalysis(records(2))).state,'accumulating');assert.equal(c.hunterSampleMaturity(c.hunterBuildAnalysis(records(3))).state,'preliminary');assert.equal(c.hunterSampleMaturity(c.hunterBuildAnalysis(records(100))).state,'preliminary');
 const html=c.hunterAnalysisContextHtml(c.hunterBuildAnalysis(records(3)));assert.match(html,/穩定分析門檻待歷史回測校準/);assert.match(html,/hunter-analysis-v1-b2-base/);assert.match(html,/分析時間/);assert.match(html,/被轉停 100%（初步）/);
});
test('same-size comparison uses percentage points and current engine with both sample counts',()=>{
 const c=setup(),html=c.hunterTrendHtml(records(40));assert.match(html,/最近 20 場/);assert.match(html,/前期 20 場/);assert.match(html,/\+100 個百分點/);assert.match(html,/hunter-trend-v1/);assert.match(html,/同口徑比較/);
 c.hunterProfileCache.records=records(40);assert.equal(c.hunterRecordsForPeriod('recent20').length,20);assert.equal(c.hunterRecordsForPeriod('recent20')[0].matchId,'m40');
 const a=c.hunterBuildAnalysis(records(40)),before=a.overall;c.hunterTrendHtml(records(40));assert.equal(a.overall,before);assert.ok(a.computedAt>0);
});
test('ties in preliminary loss description preserve both methods and no loss is distinct',()=>{
 const c=setup(),a=c.hunterBuildAnalysis(records(3));a.weakness=[{label:'爆裂',points:3,share:50},{label:'轉停',points:3,share:50}];assert.match(c.hunterAnalysisContextHtml(a),/被爆裂 50%／被轉停 50%/);
 a.weakness=[{label:'轉停',points:0,share:0}];assert.match(c.hunterAnalysisContextHtml(a),/尚無有效失分事件/);
});
