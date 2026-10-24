'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
test('audited test room remains in the test archive despite stale official metadata',()=>{
 const c=setup(),r=record({eventCode:'BXH-C6BATA',eventName:'雙敗制測試',eventAuthority:'official',testMode:false});
 const result=c.playerCenterRecordPartition([r]);
 assert.equal(result.official.length,0);assert.equal(result.test.length,1);
 c.hunterProfileCache.records=[r];
 assert.ok(c.renderPlayerCenterCareer().includes('測試紀錄（1 場賽事）'));
 assert.ok(!c.renderPlayerCenterOverview({}).includes('雙敗制測試'));
});
function extract(name){let a=core.indexOf('function '+name+'(');if(core.slice(a-6,a)==='async ')a-=6;const b=core.indexOf('\n}',a+1)+2;assert.ok(a>=0);return core.slice(a,b);}
function setup(){
 const c=vm.createContext({window:{},console,setTimeout:()=>0,sessionStorage:{getItem:()=>null}});
 for(const file of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+file+'.js','utf8'),c);
 Object.assign(c,c.window.BXHHunterUtils,{hunterRecordEventKey:c.window.BXHDomainUtils.hunterRecordEventKey,
 esc:s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
 hunterProfileCache:{records:[],skipped:[]},hunterProfileLoading:false,hunterProfileError:null,
 myRegistrationsTournamentInfo:{},myRegistrationsCache:[],myRegistrationsLoading:false,myRegistrationsError:null,
 myRegistrationsPartial:false,
 playerCenterResultScope:'',playerCenterResultRequest:0,playerCenterEventResults:new Map(),engagementSessionEpoch:1,ladderReadWithTimeout:p=>p,renderPreservingScroll:()=>{},playerCenterPeriod:'career',playerCenterHistoryVisibleCount:10,playerCenterCareerVisibleCount:10,currentAuthUid:()=> 'self',hunterSeasonStartMs:()=>Date.parse('2026-10-01T00:00:00+08:00'),
 HUNTER_OFFICIAL_LAUNCH_AT:Date.parse('2026-10-01T00:00:00+08:00'),
 effectiveGameId:p=>p.gameId,playerDerivedId:()=> 'P1',ROLE_ICON_PLAYER:'本人',myLadderProfileCache:null,
 accountEquippedTitleHtml:()=>'',engagementSnapshot:null,hunterBuildAnalysis:()=>({}),hunterLicenseOverview:c.window.BXHHunterUtils.hunterLicenseOverview,
 hunterRecordCardHtml:r=>'<article>'+c.esc(r.opponent?.name||'對手')+'</article>',
 renderPlayerRegisteredTab:()=>'<div>目前賽程</div>',schedulePhase:info=>info.phase||'waiting'});
 for(const name of ['playerCenterResultContext','loadPlayerCenterEventResult','playerCenterEventOutcome','playerCenterEventOutcomeHtml','playerCenterEventGroups','playerCenterRecordPartition','playerCenterDataNotice','playerCenterEventHtml','renderPlayerCenterCareer','playerCenterHunterSummaryHtml','renderPlayerCenterOverview'])vm.runInContext(extract(name),c);
 return c;
}
const record=(overrides={})=>({eventCode:'E1',eventName:'週末賽',eventDate:'2026-10-18',matchId:'m1',completedAt:Date.parse('2026-10-18T15:00:00+08:00'),completed:true,isWin:true,scoringVersion:'bxh-4pt-v1',round:1,...overrides});
test('saved maximum is labeled permanent only with a valid server response; incomplete or malformed responses retain replay labeling',()=>{
 const c=setup();vm.runInContext(fs.readFileSync('modules/main-app/hunter-license-v21.js','utf8'),c);
 const response={version:'hunter-license-v2.1',status:'awarded',highestTier:'b',awarded:true,current:{tier:'c',score:48.84622717893441,strength:47,matches:19}};
 c.hunterProfileCache.permanentLicense=response;
 let html=c.playerCenterHunterSummaryHtml([], 'ready');assert.ok(html.includes('生涯最高（永久授予）'));assert.ok(html.includes('B 級獵人'));
 assert.ok(html.includes('C 級獵人'));assert.ok(html.includes('48.8'));
 c.hunterProfileCache.permanentLicense={...response,version:'unverified'};
 html=c.playerCenterHunterSummaryHtml([], 'ready');assert.ok(html.includes('生涯最高（歷史回算）'));assert.ok(!html.includes('生涯最高（永久授予）'));
 c.hunterProfileCache.permanentLicense={...response,status:'blocked_incomplete_history',current:null};
 html=c.playerCenterHunterSummaryHtml([], 'partial');assert.ok(html.includes('生涯最高（永久授予）'));assert.ok(html.includes('B 級獵人'));
});
test('event groups share Hunter canonicalization: corrections replace wins, revocations and byes stay excluded',()=>{
 const c=setup(),r=record();const groups=c.playerCenterEventGroups([r,{...r,isWin:false,updatedAt:r.completedAt+1},record({matchId:'bye',isBye:true}),record({matchId:'revoked'}),record({matchId:'revoked',completed:false,updatedAt:r.completedAt+2}),record({eventCode:'E2'})]);
 assert.equal(groups.length,2);const group=groups.find(g=>g.code==='E1');assert.equal(group.summary.matches,1);assert.equal(group.summary.wins,0);assert.equal(group.summary.losses,1);
});
test('overview uses its own source and period without touching Hunter filters; PK and enchantment excluded from headline',()=>{
 const c=setup();c.hunterBattleFilter='pk';c.hunterOverviewPeriod='today';c.hunterProfileCache.records=[record(),record({matchId:'m2',isWin:false}),record({eventCode:'OLD',completedAt:Date.parse('2026-09-01')}),record({eventCode:'PK',sourceType:'hunter-clash'}),record({eventCode:'EN',scoringVersion:'bxh-enchantment-v2'})];
 c.playerCenterPeriod='season';let html=c.renderPlayerCenterOverview({gameId:'黑爸'});assert.ok(html.includes('>1</div><div class="label">有完成對戰的賽事'));assert.ok(html.includes('2–1')===false);assert.ok(html.includes('1–1'));assert.ok(html.includes('50%'));assert.equal(c.hunterBattleFilter,'pk');assert.equal(c.hunterOverviewPeriod,'today');
 c.playerCenterPeriod='career';html=c.renderPlayerCenterOverview({});assert.ok(html.includes('1–1'));assert.ok(html.includes('50%'));assert.ok(!html.includes('2–1'));
 c.playerCenterPeriod='prelaunch';html=c.renderPlayerCenterOverview({});assert.ok(html.includes('1–0'));assert.ok(html.includes('S1 前對戰不計入正式天梯積分'));
});
test('S1 boundary keeps Loft results official and prelaunch or undated records separate',()=>{
 const c=setup(),loft=record({eventCode:'BXH-GJHTTW',eventName:'BXH x Loft',eventDate:'2026-10-17',matchId:'m6'});
 c.hunterProfileCache.records=[loft,{...loft,matchId:'m70',isWin:false},record({eventCode:'S0',eventDate:'2026-09-30',completedAt:Date.parse('2026-09-30T23:59:59+08:00')}),record({eventCode:'S1',eventDate:'2026-10-01',completedAt:Date.parse('2026-10-01T00:00:00+08:00')}),record({eventCode:'UNKNOWN',eventDate:'',completedAt:0,confirmedAt:0})];
 const partition=c.playerCenterRecordPartition(c.hunterProfileCache.records);
 assert.equal(partition.official.length,3);assert.equal(partition.prelaunch.length,1);assert.equal(partition.undated.length,1);
 c.playerCenterPeriod='career';const html=c.renderPlayerCenterOverview({});assert.ok(html.includes('2–1'));assert.ok(html.includes('日期待核對 1 場對戰'));
 const career=c.renderPlayerCenterCareer();assert.ok(career.includes('BXH x Loft'));assert.ok(career.includes('1 勝 1 敗'));assert.ok(career.includes('S1 前紀錄（1 場賽事）'));assert.ok(career.includes('日期待核對（1 場賽事）'));
});
test('explicit test metadata separates archived test matches without classifying by title',()=>{
 const c=setup();c.hunterProfileCache.records=[record({eventCode:'TEST',eventName:'雙敗制測試',testMode:true}),record({eventCode:'OFFICIAL',eventName:'名稱包含測試的正式賽',eventAuthority:'official',matchId:'m2'})];
 const partition=c.playerCenterRecordPartition(c.hunterProfileCache.records);
 assert.equal(partition.test.length,1);assert.equal(partition.official.length,1);
 const career=c.renderPlayerCenterCareer();assert.ok(career.includes('測試紀錄（1 場賽事）'));assert.ok(career.includes('雙敗制測試'));
 const overview=c.renderPlayerCenterOverview({});assert.ok(overview.includes('1–0'));assert.ok(!overview.includes('雙敗制測試'));
 assert.ok(overview.includes('我的獵人旅程'));assert.ok(!overview.includes('player-center-schedule'));
 assert.ok(!overview.includes('renderPlayerRegisteredTab'));
});
test('hunter journey milestones use official records and show partial grade honestly',()=>{
 const c=setup();c.hunterProfileCache.records=[record({eventCode:'TEST',testMode:true,eventDate:'2026-10-01'}),record({eventCode:'OFFICIAL',matchId:'m2',eventDate:'2026-10-03'})];
 let html=c.playerCenterHunterSummaryHtml(c.hunterProfileCache.records,'ready');
 assert.ok(html.includes('2026-10-03'));assert.ok(!html.includes('2026-10-01'));
 c.hunterProfileCache.skipped=[{code:'MISSING',reason:'read-failed'}];
 html=c.playerCenterHunterSummaryHtml(c.hunterProfileCache.records,'partial');
 assert.ok(html.includes('等級待核對'));assert.ok(html.includes('資料待核對')||html.includes('評級中'));
});
test('loading, errors and missing season never show zero victories as verified stats; partial history is explicit',()=>{
 const c=setup();c.hunterProfileCache=null;let html=c.renderPlayerCenterOverview({});assert.ok(html.includes('正在讀取本人戰績'));assert.ok(!html.includes('>0–0<'));assert.ok(!html.includes('>0%<'));
 c.hunterProfileCache={records:[],skipped:[]};c.hunterProfileError='連線失敗';html=c.renderPlayerCenterOverview({});assert.ok(html.includes('連線失敗'));assert.ok(!html.includes('>0–0<'));
 c.hunterProfileError=null;c.hunterProfileCache={records:[record()],skipped:[{code:'MISSING',reason:'read-failed'}]};html=c.renderPlayerCenterOverview({});assert.ok(html.includes('不代表完整生涯'));assert.ok(html.includes('MISSING：賽事讀取失敗'));
 c.playerCenterPeriod='season';c.hunterSeasonStartMs=()=>0;html=c.renderPlayerCenterOverview({});assert.ok(html.includes('賽季起始時間尚未載入'));assert.ok(!html.includes('>0–0<'));
});
test('career preserves nonstandard sources and unknown dates without inventing placement or leaking markup',()=>{
 const c=setup();c.hunterProfileCache.records=[record({eventName:'<img src=x onerror=alert(1)>',completedAt:0,eventDate:'',opponent:{name:'對手'}}),record({eventCode:'EN',scoringVersion:'bxh-enchantment-v2'})];
 const html=c.renderPlayerCenterCareer();assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('日期未記錄'));assert.ok(html.includes('尚未核對入帳紀錄'));assert.ok(html.includes('EN'));assert.ok(!html.includes('冠軍'));
 c.myRegistrationsTournamentInfo.E1={phase:'live'};assert.ok(c.renderPlayerCenterCareer().includes('名次待結算'));c.myRegistrationsTournamentInfo.E1={phase:'done'};assert.ok(c.renderPlayerCenterCareer().includes('未記錄名次'));
});
test('career history initially limits full event cards and reveals the rest on demand',()=>{
 const c=setup();c.hunterProfileCache.records=Array.from({length:12},(_,i)=>record({eventCode:'E'+i,matchId:'m'+i}));
 let html=c.renderPlayerCenterCareer();assert.ok(html.includes('載入更多賽事'));assert.equal((html.match(/data-personal-event=/g)||[]).length,10);
 c.playerCenterCareerVisibleCount=20;html=c.renderPlayerCenterCareer();assert.equal((html.match(/data-personal-event=/g)||[]).length,12);assert.ok(!html.includes('載入更多賽事'));
});
test('active schedule excludes completed and cancelled entries, keeps family participants distinct',()=>{
 const c=setup();Object.assign(c,{normalizeRoomCodeInput:String,smartCallModel:()=>({kind:'waiting'}),isCommunityQuickRegistration:()=>false,publicTournamentRegistrationLocked:()=>true,scheduleSmartCallAutoRefresh:()=>{},scheduleGroups:(key,rows,card)=>rows.map(card).join('')});
 vm.runInContext(extract('renderPlayerRegistrationCard'),c);
 vm.runInContext(extract('renderPlayerRegisteredTab'),c);
 c.myRegistrationsTournamentInfo={LIVE:{phase:'live',name:'現場賽'},DONE:{phase:'done',name:'完賽'}};
 c.myRegistrationsCache=[{tournamentCode:'LIVE',status:'waitlist',displayName:'本人'},{tournamentCode:'LIVE',status:'waitlist',displayName:'孩子',familyPlayerId:'child'},{tournamentCode:'DONE',status:'confirmed'},{tournamentCode:'CANCEL',status:'cancelled'}];
 const html=c.renderPlayerRegisteredTab({activeOnly:true});assert.ok(html.includes('參賽者：本人'));assert.ok(html.includes('孩子，由家長代報名'));assert.ok(!html.includes('完賽'));assert.ok(!html.includes('CANCEL'));
 assert.ok(c.renderPlayerRegisteredTab().includes('完賽'));
 c.myRegistrationsCache=[];c.myRegistrationsPartial=true;
 assert.ok(c.renderPlayerRegisteredTab().includes('清單可能不完整'));
});
test('profile keeps basic data and title paths while new account defaults to overview',()=>{
 assert.ok(core.includes('playerProfileSection="overview"'));assert.ok(core.includes("['overview','career','basic','titles'].includes(section)"));assert.ok(core.includes("v.playerTab==='profile'?'profile'"));
 for(const section of ['overview','career','basic','titles'])assert.ok(core.includes('data-section="'+section+'"'));
 assert.ok(extract('renderPlayerProfileTab').includes('data-action="family-open"'));assert.ok(extract('renderPlayerProfileTab').includes('renderPlayerTitleCenter(p)'));
});
test('settled evidence preserves real zero points and exact placement rather than guessing',()=>{
 const c=setup();c.playerCenterResultContext();const group=c.playerCenterEventGroups([record({eventCode:'BXH-E1',participantLocalPlayerId:'local'})])[0];
 c.playerCenterEventResults.set('BXH-E1',{evidence:{status:'settled',points:0,placement:8},info:{phase:'done'}});
 let outcome=c.playerCenterEventOutcome(group);assert.equal(outcome.points,'0 PT');assert.equal(outcome.placeLabel,'第 8 名');assert.equal(outcome.status,'本人已入帳');
 c.playerCenterEventResults.set('BXH-E1',{evidence:{status:'settled',points:42,placement:2},info:{phase:'done'}});
 assert.equal(c.playerCenterEventOutcome(group).placeLabel,'亞軍');assert.equal(c.playerCenterEventOutcome(group).points,'+42 PT');
});
test('public podium requires finished state and one resolved participant ID; names and family IDs cannot grant placement',()=>{
 const c=setup();c.playerCenterResultContext();const g=c.playerCenterEventGroups([record({participantLocalPlayerId:'local'})])[0];
 c.myRegistrationsTournamentInfo.E1={phase:'live',parsedData:{championId:'local'}};assert.equal(c.playerCenterEventOutcome(g).placeLabel,'名次待結算');
 c.myRegistrationsTournamentInfo.E1.phase='done';assert.equal(c.playerCenterEventOutcome(g).placeLabel,'冠軍');
 g.records.push(record({participantLocalPlayerId:'child'}));assert.equal(c.playerCenterEventOutcome(g).placeLabel,'未記錄名次');
 g.records=[record({opponent:{name:'local'}})];assert.equal(c.playerCenterEventOutcome(g).placeLabel,'未記錄名次');
});
test('no receipt, partial failure and multiple receipts never become zero points or settled self results',()=>{
 const c=setup();c.playerCenterResultContext();const g=c.playerCenterEventGroups([record({eventCode:'BXH-E1'})])[0];
 for(const [row,status] of [[{evidence:{status:'none'},info:{phase:'done',ladderMode:'ranked',ladderPointsAwarded:true}},'全場已結算，未查得本人入帳'],[{evidence:{status:'none'},info:{phase:'done',ladderMode:'general'}},'一般賽事，不計天梯'],[{error:true},'部分成績讀取失敗'],[{evidence:{status:'ambiguous'}},'多筆入帳紀錄，需核對']]){
 c.playerCenterEventResults.set(g.code,row);const outcome=c.playerCenterEventOutcome(g);assert.equal(outcome.points,'—');assert.equal(outcome.status,status);
 }
});
test('lazy result reads deduplicate, can retry failure, and never write after account/session changes',async()=>{
 const c=setup();let calls=0,finish;let uid='self';c.currentAuthUid=()=>uid;
 c.window.cloudSync={getMyLadderEventResult:()=>{calls++;return new Promise(r=>finish=r);},getPublicTournamentSummary:async()=>({phase:'done'})};
 const p=c.loadPlayerCenterEventResult('BXH-E1');await c.loadPlayerCenterEventResult('BXH-E1');assert.equal(calls,1);
 uid='other';c.playerCenterResultContext();finish({status:'settled',points:99,placement:1});await p;assert.equal(c.playerCenterEventResults.size,0);
 c.window.cloudSync.getMyLadderEventResult=async()=>{calls++;throw Error('network');};await c.loadPlayerCenterEventResult('BXH-E1');assert.equal(c.playerCenterEventResults.get('BXH-E1').error,true);
 c.window.cloudSync.getMyLadderEventResult=async()=>{calls++;return {status:'settled',points:2};};await c.loadPlayerCenterEventResult('BXH-E1',true);assert.equal(c.playerCenterEventResults.get('BXH-E1').evidence.points,2);
 const previous=calls;await c.loadPlayerCenterEventResult('BXH-E1');assert.equal(calls,previous);
 c.engagementSessionEpoch++;c.playerCenterResultContext();assert.equal(c.playerCenterEventResults.size,0);
});
test('late result from previous login epoch cannot populate the same UID cache',async()=>{
 const c=setup();let finish;c.window.cloudSync={getMyLadderEventResult:()=>new Promise(r=>finish=r),getPublicTournamentSummary:async()=>({phase:'done'})};
 const p=c.loadPlayerCenterEventResult('BXH-E1');c.engagementSessionEpoch++;finish({status:'settled',points:100});await p;assert.equal(c.playerCenterEventResults.size,0);
});

const cloudRuntime=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8');
function resultCloud(){
 let query,resolve;const rows=[];
 const c=vm.createContext({cloudEnabled:true,authHandle:{currentUser:{uid:'self'}},engagementSessionEpoch:1,dbHandle:{},cloudSafeTimestampMs:v=>v||0,
 fx:{collection:(_db,name)=>name,where:(...a)=>['where',...a],query:(...a)=>a,limit:n=>['limit',n],getDocs:async q=>{query=q;return {forEach:cb=>rows.forEach(r=>cb({data:()=>r}))};}}});
 const a=cloudRuntime.indexOf('    async getMyLadderEventResult('),b=cloudRuntime.indexOf('    async getTestLadderRanking(',a);vm.runInContext('var api={'+cloudRuntime.slice(a,b)+'};',c);
 return {c,rows,query:()=>JSON.parse(JSON.stringify(query))};
}
test('event evidence is always self-only across roles and seasons, without querying admin-wide audit logs',async()=>{
 const {c,rows,query}=resultCloud();c.userProfile={role:'super_admin'};rows.push({type:'event',playerUid:'self',eventCode:'BXH-E1',seasonId:'S0',delta:0,placement:2,createdAt:123,actorUid:'private'});
 const out=await c.api.getMyLadderEventResult('bxh-e1');assert.deepEqual(query(),['ladderTransactions',['where','playerUid','==','self'],['where','eventCode','==','BXH-E1'],['where','type','==','event'],['limit',2]]);
 assert.equal(out.points,0);assert.equal(out.seasonId,'S0');assert.equal(out.placement,2);assert.ok(!JSON.stringify(out).includes('actorUid'));
});
test('missing and ambiguous transactions return explicit states, malformed points never become zero',async()=>{
 const {c,rows}=resultCloud();assert.equal((await c.api.getMyLadderEventResult('BXH-E1')).status,'none');
 rows.push({type:'event',playerUid:'self',eventCode:'BXH-E1',pointsEarned:8,placement:null});assert.equal((await c.api.getMyLadderEventResult('BXH-E1')).points,8);
 rows[0].pointsEarned=null;await assert.rejects(()=>c.api.getMyLadderEventResult('BXH-E1'),/event-points-invalid/);
 rows.push({...rows[0],delta:5});assert.equal((await c.api.getMyLadderEventResult('BXH-E1')).status,'ambiguous');
});
test('authentication, event identity, test isolation and session epoch guard event evidence',async()=>{
 const {c,rows}=resultCloud();await assert.rejects(()=>c.api.getMyLadderEventResult('bad'),/invalid-event-code/);
 c.authHandle.currentUser=null;await assert.rejects(()=>c.api.getMyLadderEventResult('BXH-E1'),/auth-required/);c.authHandle.currentUser={uid:'self'};
 rows.push({type:'event',playerUid:'child',eventCode:'BXH-E1',delta:10});await assert.rejects(()=>c.api.getMyLadderEventResult('BXH-E1'),/event-evidence-invalid/);
 rows[0].playerUid='self';rows[0].eventAuthority='test';await assert.rejects(()=>c.api.getMyLadderEventResult('BXH-E1'),/event-evidence-invalid/);
 const previous=c.fx.getDocs;c.fx.getDocs=async q=>{const data=await previous(q);c.engagementSessionEpoch++;return data;};await assert.rejects(()=>c.api.getMyLadderEventResult('BXH-E1'),/stale-session/);
});
module.exports={setup,extract,record};
