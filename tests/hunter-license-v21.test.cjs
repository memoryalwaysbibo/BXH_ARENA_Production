'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){const c=vm.createContext({window:{}});for(const name of ['domain-utils','hunter-utils','hunter-license-v21'])vm.runInContext(fs.readFileSync('modules/main-app/'+name+'.js','utf8'),c);return c.window.BXHHunterLicenseV21;}
const T=Date.parse('2026-10-02T12:00:00+08:00');
test('audited C6BATA results cannot alter XP, strength, experience or peak even with official metadata',()=>{
 const V=setup(),clean=[record(1),record(2)],baseline=V.overview(clean);
 for(const isWin of [true,false]){
  const result=V.overview([...clean,record(3,isWin,{eventCode:'bxh-c6bata',eventAuthority:'official',testMode:false})]);
  for(const key of ['growth','analysis','grade','life','highest'])assert.deepEqual(result[key],baseline[key]);
 }
 assert.equal(V.overview([record(3,true,{eventName:'雙敗制測試',eventCode:'OTHER'})]).life.matches,1);
});
function record(i,win=true,extra={}){const scoreFor=win?4:1,scoreAgainst=win?1:4;return {eventCode:'event'+i,matchId:'match'+i,completedAt:T+i*1000,eventAuthority:'official',formatType:'single',scoringVersion:'bxh-4pt-v1',analyzable:true,isWin:win,scoreFor,scoreAgainst,opponentIdentity:{scope:'cross-event',playerId:'opponent'+i},roundsPerspective:[...Array.from({length:scoreFor},()=>({type:'spin',points:1,perspective:'for'})),...Array.from({length:scoreAgainst},()=>({type:'spin',points:1,perspective:'against'}))],licenseEventParticipants:32,licenseParticipantSource:'completed-match-roster-v1',...extra};}
test('new entry gate supports two matches, no hidden legacy 3-match/8-round gate',()=>{const V=setup(),one=V.overview([record(1)]),two=V.overview([record(1),record(2)]);assert.equal(one.grade.tier,'ungraded');assert.equal(two.grade.tier,'e');assert.equal(two.analysis.overall,92);assert.equal(two.analysis.matches,2);assert.equal(two.gates.find(g=>g.key==='matches').target,4);assert.equal(V.overview([]).grade.label,'未分級');});
test('latest twenty played matches replace oldest regardless of input order; invalid ledger does not displace a valid match',()=>{const V=setup(),rows=Array.from({length:21},(_,i)=>record(i,i>0));rows.push(record(30,false,{scoreFor:99}));const o=V.overview(rows.reverse());assert.equal(o.analysis.matches,20);assert.equal(o.analysis.winRate,100);assert.equal(o.analysis.overall,92);assert.equal(o.life.matches,21);assert.equal(o.excluded,1);});
test('B is reachable; all life gates must be met even at maximum score',()=>{const V=setup(),rows=Array.from({length:12},(_,i)=>record(i));assert.equal(V.overview(rows).grade.tier,'b');assert.equal(V.overview(rows.map(r=>({...r,eventCode:'same'}))).grade.tier,'e');const noOpponents=V.overview(rows.map(r=>({...r,opponentIdentity:{scope:'event-only',playerId:'local'}})));assert.equal(noOpponents.grade.tier,'ungraded');assert.equal(noOpponents.life.unresolvedOpponents,12);});
test('96 and 128 boundaries are exclusive, unknown/capacity data cannot fulfill size requirements',()=>{const V=setup(),rows=Array.from({length:20},(_,i)=>record(i,true,{licenseEventParticipants:i===0?128:32}));const first=V.overview(rows.map(r=>({...r,isWin:true})));assert.equal(first.life.medium,0);assert.equal(first.life.large,1);assert.equal(first.grade.tier,'b');rows[1].licenseEventParticipants=96;const o=V.overview(rows.map(r=>({...r,isWin:true})));assert.equal(o.grade.tier,'a');assert.equal(o.life.medium,1);const x=V.experience([record(1,true,{licenseEventParticipants:95}),record(2,true,{licenseEventParticipants:96}),record(3,true,{licenseEventParticipants:127}),record(4,true,{licenseEventParticipants:128}),record(5,true,{licenseParticipantSource:'capacity',licenseEventParticipants:128})]);assert.equal(x.medium,2);assert.equal(x.large,1);assert.equal(x.unknownSizes,1);});
test('a current S can drop while replayed career peak stays S; season boundaries do not clear history',()=>{const V=setup(),rows=Array.from({length:30},(_,i)=>record(i,true,{licenseEventParticipants:i===0||i===1?96:i===2?128:32}));assert.equal(V.overview(rows).grade.tier,'s');for(let i=30;i<50;i++)rows.push(record(i,false,{completedAt:Date.parse('2027-02-01T12:00:00+08:00')+i*1000}));const o=V.overview(rows);assert.equal(o.grade.tier,'ungraded');assert.equal(o.highest.tier,'s');assert.equal(o.analysis.matches,20);assert.equal(o.analysis.winRate,0);assert.equal(o.life.matches,50);assert.equal(o.highestStatus,'replayed-not-persisted');});
test('partial reads cannot issue current or historical ranks; corrections and bye exclusions are respected',()=>{const V=setup(),rows=Array.from({length:12},(_,i)=>record(i)),partial=V.overview(rows,null,false);assert.equal(partial.grade.tier,'pending');assert.equal(partial.highest.tier,'pending');assert.equal(partial.analysis.overall,null);assert.ok(partial.gates.every(g=>g.current===null&&!g.met));rows.push({...record(0),completed:false,updatedAt:T+999999});const o=V.overview(rows);assert.equal(o.life.matches,11);assert.equal(o.grade.tier,'c');assert.equal(V.overview([record(1,true,{isBye:true}),record(2,true,{eventAuthority:'test'}),record(3,true,{completedAt:T-86400000*5}),record(4,true,{formatType:'team'}),record(5,true,{completedAt:0,eventDate:''})]).analysis.matches,0);});
test('test event flags exclude XP, current grade and historical peak; title alone does not',()=>{const V=setup(),official=record(1),testMode=record(2,true,{testMode:true}),testAuthority=record(3,true,{eventAuthority:'test'}),named=record(4,true,{eventName:'雙敗制測試'});const clean=V.overview([official,named]),mixed=V.overview([official,testMode,testAuthority,named]);assert.equal(mixed.growth.xp,clean.growth.xp);assert.equal(mixed.life.matches,clean.life.matches);assert.equal(mixed.highest.tier,clean.highest.tier);});
test('opponent identity must be verified; repeated stable identity counts once',()=>{const V=setup(),rows=[record(1),record(2,true,{opponentIdentity:{scope:'cross-event',playerId:'opponent1'}})];assert.equal(V.overview(rows).life.opponents,1);assert.equal(V.overview(rows).grade.tier,'ungraded');});
test('new UI exposes window, separate sizes and honest replay status',()=>{const V=setup(),html=V.renderOverview(V.overview([record(1),record(2)]),String);for(const text of ['2.1','最近 20 場','生涯最高','E 級獵人','尚未寫入永久授予','B 級獵人','96–127'])assert.ok(html.includes(text),text);});
test('script dependencies and legacy round formats do not crash license calculation',()=>{
  const page=fs.readFileSync('index.html','utf8');
  assert.ok(page.indexOf('domain-utils.js?')<page.indexOf('hunter-license-v21.js?'));
  const c=vm.createContext({window:{}});
  for(const name of ['hunter-utils','hunter-license-v21','domain-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+name+'.js','utf8'),c);
  const legacy={eventCode:'before-s1',eventDate:'2026-09-20',roundsPerspective:{legacy:true},isWin:false};
  assert.equal(c.window.BXHHunterUtils.hunterRecordMode(legacy),'standard');
  const summary=c.window.BXHHunterLicenseV21.overview([legacy,record(1),record(2)]);
  assert.equal(summary.life.matches,2);
  assert.equal(summary.excluded,1);
  assert.equal(summary.grade.tier,'e');
});
test('identity lookup failures are disclosed as pending evidence rather than an ungraded player',()=>{
 const V=setup(),rows=Array.from({length:25},(_,i)=>record(i,true,{eventCode:'event'+i%6,opponentIdentity:{scope:'unresolved',playerId:null}}));
 const o=V.overview(rows),html=V.renderOverview(o,String);
 assert.equal(o.life.matches,25);assert.equal(o.life.events,6);assert.equal(o.life.opponents,0);
 assert.equal(o.life.identityFailed,25);assert.equal(o.grade.tier,'ungraded');
 assert.equal(V.displayGrade(o).label,'對手資料待核對');
 assert(html.includes('查詢失敗 25 場'));assert(html.includes('有 25 場待核對'));
 assert(html.includes('data-action="hunter-refresh"'));assert(!html.includes('還差 2</small>'));
 // Recovery recomputes both the current and historical grade from verified identities.
 rows.forEach((r,i)=>r.opponentIdentity={scope:'cross-event',playerId:'H2H_'+i%8});
 const recovered=V.overview(rows);
 assert.equal(recovered.life.opponents,8);assert.equal(V.displayGrade(recovered).tier,'b');
 assert.equal(recovered.highest.tier,'b');assert(!V.renderOverview(recovered,String).includes('data-action="hunter-refresh"'));
});
test('loading, failed, unverified and confirmed event-only identities remain distinct',()=>{
 const V=setup(),scopes=['loading','unresolved',null,'event-only'];
 const rows=scopes.map((scope,i)=>record(i,true,{opponentIdentity:scope?{scope,playerId:null}:undefined}));
 const o=V.overview(rows),s=V.identityStatus(o);
 assert.equal(s.pending,3);assert.equal(s.loading,1);assert.equal(s.failed,1);assert.equal(s.unverified,1);assert.equal(s.excluded,1);
 const excluded=V.overview(rows.slice(3));assert.equal(V.displayGrade(excluded).tier,'ungraded');
 assert.equal(V.displayGrade(V.overview([])).tier,'ungraded');
});
test('pending identity display does not hide a verified server grade or claim a permanent award',()=>{
 const V=setup(),o=V.overview([record(1,true,{opponentIdentity:{scope:'loading'}}),record(2,true,{opponentIdentity:{scope:'loading'}})]);
 const snapshot={version:V.version,status:'unchanged',highestTier:null,awarded:false,current:{tier:'ungraded',score:92,strength:92,matches:2}};
 assert.equal(V.displayGrade(o,snapshot).tier,'pending');
 snapshot.current.tier='e';snapshot.highestTier='e';
 assert.equal(V.displayGrade(o,snapshot).tier,'e');assert.equal(V.displayGrade(o,snapshot).label,'E 級獵人');
 const html=V.renderOverview(o,String,snapshot);assert(html.includes('目前：E 級獵人'));
 assert.equal(V.displayGrade(V.overview([],null,false)).label,'資料待核對');
});
