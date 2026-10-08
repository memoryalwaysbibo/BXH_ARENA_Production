'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function setup(){
 const c=vm.createContext({window:{},console,setTimeout:()=>{}});
 for(const file of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+file+'.js','utf8'),c);
 Object.assign(c,c.window.BXHHunterUtils,{HUNTER_ANALYSIS_TYPES:['extreme','knockout','burst','spin'],HUNTER_ANALYSIS_LABELS:{extreme:'極限',knockout:'擊飛',burst:'爆裂',spin:'轉停'},HUNTER_ANALYSIS_MIN_MATCHES:3,HUNTER_ANALYSIS_MIN_ROUNDS:8,esc:String,hunterEvidenceHtml:()=>'<div>source matches</div>',hunterRadarMetric:'points'});
 for(const name of ['hunterBuildAnalysis','hunterRadarSvg','hunterRadarHtml','hunterAnalysisStatHtml']){
  const a=core.indexOf('function '+name+'('),b=core.indexOf('\nfunction ',a+1);vm.runInContext(core.slice(a,b),c);
 }
 return c;
}
function bucket(points=[3,2,2,1],events=[1,1,1,1]){return Object.fromEntries(['extreme','knockout','burst','spin'].map((t,i)=>[t,{points:points[i],events:events[i]}]));}
function analysis(){return {attack:bucket(),defense:bucket([0,2,0,1],[0,1,0,1])};}
test('count and point shares use independent own-gain and own-loss denominators',()=>{
 const c=setup(),a=analysis(),points=c.hunterDistributionRows(a.attack,'points'),counts=c.hunterDistributionRows(a.attack,'events'),loss=c.hunterDistributionRows(a.defense,'points');
 assert.equal(points[0].share,38);assert.equal(points[0].numerator,3);assert.equal(points[0].denominator,8);
 assert.equal(counts[0].share,25);assert.equal(counts[0].denominator,4);
 assert.equal(loss[1].share,67);assert.equal(loss[1].denominator,3);assert.equal(loss[0].share,0);
});
test('missing direction has null shares and no fabricated polygon, zero occurrence stays 0%',()=>{
 const c=setup(),a=analysis();a.defense=bucket([0,0,0,0],[0,0,0,0]);
 assert.equal(c.hunterDistributionRows(a.defense)[0].share,null);
 const svg=c.hunterRadarSvg(a);assert.doesNotMatch(svg,/hunter-radar-shape loss/);assert.match(svg,/被極限 無資料/);
 const html=c.hunterRadarHtml(a);assert.match(html,/被極限<br><b>—/);assert.match(html,/失分方式｜分母 0 分/);
 a.defense=bucket([0,2,0,1],[0,1,0,1]);assert.match(c.hunterRadarHtml(a),/被極限<br><b>0%/);
});
test('100% radius is literal, 50% and 25% remain proportional and labels match plotted values',()=>{
 const c=setup();assert.equal(c.hunterRadarVisualValue(50),50);assert.equal(c.hunterRadarVisualValue(100),100);assert.equal(c.hunterRadarVisualValue(25),25);
 assert.equal(c.hunterRadarPolygonPoints([50,0,0,0,0,0,0,0]).split(' ')[0],'160.0,107.5');
 const a=analysis(),svg=c.hunterRadarSvg(a,'events');assert.match(svg,/cx="160.0" cy="133.8"/);assert.match(svg,/極限 25%（1 \/ 4）/);
 assert.match(svg,/hunter-radar-shape attack/);assert.match(svg,/hunter-radar-shape loss/);
 for(const n of [25,50,75,100])assert.match(svg,new RegExp('>'+n+'%</text>'));
 assert.doesNotMatch(svg,/50% 分布＝滿格/);
});
test('inline statistics disclose selected fraction and both event and point denominators',()=>{
 const c=setup(),html=c.hunterAnalysisStatHtml(analysis().attack,'extreme','for','events');
 assert.match(html,/id="hunter-analysis-for-extreme"/);assert.match(html,/次數占比＝1 \/ 4 回（25%）/);assert.match(html,/分數：3 \/ 8 分/);assert.match(html,/source matches/);
 assert.match(c.hunterAnalysisStatHtml(analysis().defense,'knockout','against','points'),/分數占比＝2 \/ 3 分（67%）/);
 const empty=c.hunterAnalysisStatHtml(bucket([0,0,0,0],[0,0,0,0]),'extreme');assert.match(empty,/0 \/ 0 分（—）/);
});
test('enchantment base points and event counts exclude faults and ignore card deltas; score never changes',()=>{
 const c=setup(),r={eventCode:'B3',matchId:'e',scoringVersion:'bxh-enchantment-v2',analyzable:true,isWin:true,scoreFor:5,scoreAgainst:0,roundsPerspective:[{v:2,type:'burst',basePoints:2,delta:1,points:3,perspective:'for'},{v:2,type:'spin',basePoints:1,delta:0,points:1,perspective:'for'},{v:2,type:'spin',basePoints:1,delta:-1,points:0,perspective:'against'},{v:2,type:'fault',basePoints:1,delta:0,points:1,perspective:'for'}]};
 const a=c.hunterBuildAnalysis([r]);assert.equal(a.overall,null);
 const counts=c.hunterDistributionRows(a.attack,'events'),points=c.hunterDistributionRows(a.attack,'points');
 assert.equal(counts[2].denominator,2);assert.equal(counts[2].share,50);assert.equal(points[2].denominator,3);assert.equal(points[2].share,67);
 assert.equal(c.hunterDistributionRows(a.defense,'points')[3].share,100);
 c.hunterRadarHtml(a,'events');assert.equal(a.overall,null);assert.equal(a.attack.burst.points,2);assert.equal(r.scoreFor,5);
});
test('real action handlers validate metric and expand the corresponding inline source',()=>{
 const c=setup(),a=core.indexOf('  if(action==="hunter-radar-metric")'),b=core.indexOf('  if(action==="hunter-battle-filter")',a),handler='(function(){'+core.slice(a,b)+'})()';
 c.action='hunter-radar-metric';c.target={getAttribute:()=> 'events'};c.renderPreservingScroll=()=>c.rendered=true;vm.runInContext(handler,c);assert.equal(c.hunterRadarMetric,'events');assert.equal(c.rendered,true);
 c.target={getAttribute:()=> 'invalid'};vm.runInContext(handler,c);assert.equal(c.hunterRadarMetric,'events');
 c.action='hunter-radar-axis';const detail={open:false,scrollIntoView:opts=>assert.equal(opts.block,'nearest')};
 c.document={getElementById:id=>{assert.equal(id,'hunter-analysis-against-spin');return detail;}};
 c.target={getAttribute:key=>key==='data-type'?'spin':'against'};vm.runInContext(handler,c);assert.equal(detail.open,true);
 c.document={getElementById:()=>{throw Error('invalid axis accessed DOM')}};c.target={getAttribute:()=> 'invalid'};vm.runInContext(handler,c);
 const html=c.hunterRadarHtml(analysis());assert.equal((html.match(/data-action="hunter-radar-axis"/g)||[]).length,8);assert.match(html,/aria-controls="hunter-analysis-against-spin"/);assert.match(html,/失分占比不代表防守能力較強/);
});
