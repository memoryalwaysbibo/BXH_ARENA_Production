'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function extract(name){const a=core.indexOf('function '+name+'('),b=core.indexOf('\n}',a+1)+2;assert.ok(a>=0);return core.slice(a,b);}
function setup(){
 const c=vm.createContext({window:{},console,setTimeout:()=>0,sessionStorage:{getItem:()=>null}});
 for(const file of ['domain-utils','hunter-utils'])vm.runInContext(fs.readFileSync('modules/main-app/'+file+'.js','utf8'),c);
 Object.assign(c,c.window.BXHHunterUtils,{hunterRecordEventKey:c.window.BXHDomainUtils.hunterRecordEventKey,
 esc:s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
 hunterProfileCache:{records:[],skipped:[]},hunterProfileLoading:false,hunterProfileError:null,
 myRegistrationsTournamentInfo:{},myRegistrationsCache:[],myRegistrationsLoading:false,myRegistrationsError:null,
 playerCenterPeriod:'career',currentAuthUid:()=> 'self',hunterSeasonStartMs:()=>Date.parse('2026-10-01T00:00:00+08:00'),
 effectiveGameId:p=>p.gameId,playerDerivedId:()=> 'P1',ROLE_ICON_PLAYER:'本人',myLadderProfileCache:null,
 hunterRecordCardHtml:r=>'<article>'+c.esc(r.opponent?.name||'對手')+'</article>',
 renderPlayerRegisteredTab:()=>'<div>目前賽程</div>',schedulePhase:info=>info.phase||'waiting'});
 for(const name of ['playerCenterEventGroups','playerCenterDataNotice','playerCenterEventHtml','renderPlayerCenterCareer','renderPlayerCenterOverview'])vm.runInContext(extract(name),c);
 return c;
}
const record=(overrides={})=>({eventCode:'E1',eventName:'週末賽',eventDate:'2026-10-18',matchId:'m1',completedAt:Date.parse('2026-10-18T15:00:00+08:00'),completed:true,isWin:true,scoringVersion:'bxh-4pt-v1',round:1,...overrides});
test('event groups share Hunter canonicalization: corrections replace wins, revocations and byes stay excluded',()=>{
 const c=setup(),r=record();const groups=c.playerCenterEventGroups([r,{...r,isWin:false,updatedAt:r.completedAt+1},record({matchId:'bye',isBye:true}),record({matchId:'revoked'}),record({matchId:'revoked',completed:false,updatedAt:r.completedAt+2}),record({eventCode:'E2'})]);
 assert.equal(groups.length,2);const group=groups.find(g=>g.code==='E1');assert.equal(group.summary.matches,1);assert.equal(group.summary.wins,0);assert.equal(group.summary.losses,1);
});
test('overview uses its own source and period without touching Hunter filters; PK and enchantment excluded from headline',()=>{
 const c=setup();c.hunterBattleFilter='pk';c.hunterOverviewPeriod='today';c.hunterProfileCache.records=[record(),record({matchId:'m2',isWin:false}),record({eventCode:'OLD',completedAt:Date.parse('2026-09-01')}),record({eventCode:'PK',sourceType:'hunter-clash'}),record({eventCode:'EN',scoringVersion:'bxh-enchantment-v2'})];
 c.playerCenterPeriod='season';let html=c.renderPlayerCenterOverview({gameId:'黑爸'});assert.ok(html.includes('>1</div><div class="label">有完成對戰的賽事'));assert.ok(html.includes('2–1')===false);assert.ok(html.includes('1–1'));assert.ok(html.includes('50%'));assert.equal(c.hunterBattleFilter,'pk');assert.equal(c.hunterOverviewPeriod,'today');
 c.playerCenterPeriod='career';html=c.renderPlayerCenterOverview({});assert.ok(html.includes('2–1'));assert.ok(html.includes('67%'));
});
test('loading, errors and missing season never show zero victories as verified stats; partial history is explicit',()=>{
 const c=setup();c.hunterProfileCache=null;let html=c.renderPlayerCenterOverview({});assert.ok(html.includes('正在讀取本人戰績'));assert.ok(!html.includes('>0–0<'));assert.ok(!html.includes('>0%<'));
 c.hunterProfileCache={records:[],skipped:[]};c.hunterProfileError='連線失敗';html=c.renderPlayerCenterOverview({});assert.ok(html.includes('連線失敗'));assert.ok(!html.includes('>0–0<'));
 c.hunterProfileError=null;c.hunterProfileCache={records:[record()],skipped:[{code:'MISSING',reason:'read-failed'}]};html=c.renderPlayerCenterOverview({});assert.ok(html.includes('不代表完整生涯'));assert.ok(html.includes('MISSING：賽事讀取失敗'));
 c.playerCenterPeriod='season';c.hunterSeasonStartMs=()=>0;html=c.renderPlayerCenterOverview({});assert.ok(html.includes('賽季起始時間尚未載入'));assert.ok(!html.includes('>0–0<'));
});
test('career preserves nonstandard sources and unknown dates without inventing placement or leaking markup',()=>{
 const c=setup();c.hunterProfileCache.records=[record({eventName:'<img src=x onerror=alert(1)>',completedAt:0,eventDate:'',opponent:{name:'對手'}}),record({eventCode:'EN',scoringVersion:'bxh-enchantment-v2'})];
 const html=c.renderPlayerCenterCareer();assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('日期未記錄'));assert.ok(html.includes('賽事狀態尚未核對'));assert.ok(html.includes('EN'));assert.ok(!html.includes('冠軍'));
 c.myRegistrationsTournamentInfo.E1={phase:'live'};assert.ok(c.renderPlayerCenterCareer().includes('名次待結算'));c.myRegistrationsTournamentInfo.E1={phase:'done'};assert.ok(c.renderPlayerCenterCareer().includes('最終名次未接入'));
});
test('active schedule excludes completed and cancelled entries, keeps family participants distinct',()=>{
 const c=setup();Object.assign(c,{normalizeRoomCodeInput:String,smartCallModel:()=>({kind:'waiting'}),isCommunityQuickRegistration:()=>false,publicTournamentRegistrationLocked:()=>true,scheduleSmartCallAutoRefresh:()=>{},scheduleGroups:(key,rows,card)=>rows.map(card).join('')});
 vm.runInContext(extract('renderPlayerRegisteredTab'),c);
 c.myRegistrationsTournamentInfo={LIVE:{phase:'live',name:'現場賽'},DONE:{phase:'done',name:'完賽'}};
 c.myRegistrationsCache=[{tournamentCode:'LIVE',status:'waitlist',displayName:'本人'},{tournamentCode:'LIVE',status:'waitlist',displayName:'孩子',familyPlayerId:'child'},{tournamentCode:'DONE',status:'confirmed'},{tournamentCode:'CANCEL',status:'cancelled'}];
 const html=c.renderPlayerRegisteredTab({activeOnly:true});assert.ok(html.includes('參賽者：本人'));assert.ok(html.includes('孩子，由家長代報名'));assert.ok(!html.includes('完賽'));assert.ok(!html.includes('CANCEL'));
 assert.ok(c.renderPlayerRegisteredTab().includes('完賽'));
});
test('profile keeps basic data and title paths while new account defaults to overview',()=>{
 assert.ok(core.includes('playerProfileSection="overview"'));assert.ok(core.includes("['overview','career','basic','titles'].includes(section)"));assert.ok(core.includes("v.playerTab==='profile'?'profile'"));
 for(const section of ['overview','career','basic','titles'])assert.ok(core.includes('data-section="'+section+'"'));
 assert.ok(extract('renderPlayerProfileTab').includes('data-action="family-open"'));assert.ok(extract('renderPlayerProfileTab').includes('renderPlayerTitleCenter(p)'));
});
module.exports={setup,extract,record};
