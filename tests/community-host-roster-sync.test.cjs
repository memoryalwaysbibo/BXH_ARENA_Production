'use strict';
// Local production-source regressions. All services are fixtures; no network or Firebase writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const domain=fs.readFileSync(path.join(root,'modules/main-app/domain-utils.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function block(start,end){const a=core.indexOf(start),b=core.indexOf(end,a);assert(a>=0&&b>a);return core.slice(a,b);}
function fn(name){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(core);assert(match);const lineEnd=core.indexOf('\n',match.index);return /\}\s*$/.test(core.slice(match.index,lineEnd))?core.slice(match.index,lineEnd):core.slice(match.index,core.indexOf('\n}',match.index)+2);}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(overrides={}){
 const calls={subscribe:[],unsub:0,catchup:0,read:0,publicRead:0,list:0,save:0,render:0,toasts:[]};
 const state={id:'room-a',cloudCode:'ROOM-A',createdBy:'host',ownerUid:'host',updatedAt:1,registrationRosterRevision:0,communityQuickRegistration:true,meta:{eventAuthority:'community',battleMode:'individual',registrationEnabled:true,communityQuickRegistration:true},players:[{id:'host-player',name:'Host',source:'host'}],waitlistPlayers:[],matches:[]};
 const ctx=vm.createContext({console:{warn(){}},Date,JSON,window:{},firebaseUser:{uid:'host'},userProfile:{role:'player',active:true},currentRole:'player',appPhase:'community-room',communityRoomActiveTab:'people',activeTab:'live',state,peopleRosterBusy:false,adminRegistrationsCache:null,adminRegistrationsError:null,adminRegistrationsLoading:false,publicTournamentsCache:[],myRegistrationsCache:[],remoteAppliedRoomId:null,remoteAppliedAt:0,courtSwapDraft:null,refereeAssignmentDraftEnabled:null,cloudLastSyncAt:0,
 currentAuthUid:()=>ctx.firebaseUser?.uid||'',cloudAvailable:()=>true,isOwnTestTournament:()=>ctx.state.meta.eventAuthority==='test'&&ctx.state.ownerUid===ctx.firebaseUser?.uid&&ctx.state.createdBy===ctx.firebaseUser?.uid,
 resetAdminRegistrationsCache:()=>{ctx.adminRegistrationsCache=null;ctx.adminRegistrationsError=null;},defaultState:id=>({id}),saveRecord:async()=>true,saveState:async()=>{calls.save++;return true;},mapRegistrationError:error=>String(error.message||error.code),showToast:(message,error)=>calls.toasts.push({message,error}),bracketRosterIsCurrent:()=>true,
 render:()=>{calls.render++;ctx.reconcileRegistrationRosterContext();},renderPreservingScroll:()=>{calls.render++;ctx.reconcileRegistrationRosterContext();},
 ...overrides});
 ctx.window.cloudSync={connect:async()=>true,subscribeRegistrationsForAdmin:(code,next,error)=>{calls.subscribe.push({code,next,error});return ()=>{calls.unsub++;};},syncCommunityRegistrationSummary:async()=>{calls.catchup++;return {ok:true,communityParticipantCount:2};},joinRoom:async()=>{calls.read++;return {ok:true,data:clone(ctx.remote)};},getPublicTournamentFull:async()=>{calls.publicRead++;return {};},listRegistrationsForAdmin:async()=>{calls.list++;return [];}};
 vm.runInContext(domain,ctx);Object.assign(ctx,ctx.window.BXHDomainUtils);
 for(const name of ['hasAdminAccess','isCommunityRoom','isCommunityRoomOwner','isTester','applyRemoteState'])vm.runInContext(fn(name),ctx);
 vm.runInContext(block('let adminRosterUnsub=null, adminRosterCode="", adminRosterGeneration=0;','let myRegistrationsError = null;'),ctx);
 vm.runInContext(fn('syncLatestOnlineRosterBeforeLock'),ctx);
 vm.runInContext('globalThis.drainRoster=()=>adminRosterSyncChain;globalThis.rosterCode=()=>adminRosterCode;',ctx);
 const action=block('  if(action==="load-online-roster"){','  if(action==="close-checkin-early"){');
 vm.runInContext('function manualSync(target={}){const action="load-online-roster";'+action+'}',ctx);
 ctx.remote={...clone(ctx.state),updatedAt:2,registrationRosterRevision:1,players:[...clone(ctx.state.players),{id:'online-r',name:'Entrant',source:'online',registrationId:'r',checkedIn:true}]};
 return {ctx,calls};
}

test('ordinary player owner watches the COMMUNITY people tab even when app activeTab is live',async()=>{
 const {ctx,calls}=harness();await ctx.startAdminRosterWatch();assert.equal(calls.subscribe.length,1);assert.equal(calls.subscribe[0].code,'ROOM-A');
 calls.subscribe[0].next([{registrationId:'r',status:'confirmed'}]);await ctx.drainRoster();
 assert.equal(calls.catchup,1);assert.equal(calls.read,1);assert.equal(calls.save,0);assert.equal(ctx.state.players.length,2);assert.equal(ctx.state.players[1].checkedIn,true);
 calls.subscribe[0].next([{registrationId:'r',status:'confirmed'}]);await ctx.drainRoster();
 assert.equal(calls.catchup,1,'one catchup per listener, not a write on every snapshot');assert.equal(ctx.state.players.length,2);assert.equal(calls.save,0);
});

for(const [label,change] of [
 ['other owner',c=>{c.state.ownerUid='other';}],['creator mismatch',c=>{c.state.createdBy='other';}],
 ['guest',c=>{c.currentRole='guest';}],['staff mode',c=>{c.currentRole='staff';c.userProfile.role='staff';}],
 ['signed out',c=>{c.firebaseUser=null;}],['inactive account',c=>{c.userProfile.active=false;}],
 ['official room player',c=>{c.state.meta.eventAuthority='official';}],
 ['tester other sandbox',c=>{c.currentRole='tester';c.userProfile.role='tester';c.state.meta.eventAuthority='test';c.state.ownerUid='other';}],
 ])test(label+' cannot subscribe, read, or manually sync private registration data',async()=>{
 const {ctx,calls}=harness();change(ctx);await ctx.startAdminRosterWatch();await ctx.loadAdminRegistrationRows();ctx.manualSync();await tick();
 assert.equal(calls.subscribe.length,0);assert.equal(calls.list,0);assert.equal(calls.catchup,0);assert.equal(calls.read,0);assert.equal(calls.save,0);
 });

test('tester owner and existing official admin retain authorized roster access',async()=>{
 for(const type of ['community-tester','official-admin','own-test']){
 const {ctx,calls}=harness();ctx.currentRole=type==='official-admin'?'admin':'tester';ctx.userProfile.role=ctx.currentRole;
 if(type!=='community-tester'){ctx.state.meta.eventAuthority=type==='official-admin'?'official':'test';ctx.appPhase='app';ctx.activeTab='people';}
 await ctx.startAdminRosterWatch();assert.equal(calls.subscribe.length,1,type);
 }
});

for(const [label,change] of [
 ['community live tab',c=>{c.communityRoomActiveTab='live';c.activeTab='people';}],
 ['player center stale people tab',c=>{c.appPhase='player-center';c.activeTab='people';}],
 ['tournament detail stale people tab',c=>{c.appPhase='tournament-detail';c.activeTab='people';}],
 ])test(label+' does not open a management listener',async()=>{const {ctx,calls}=harness();change(ctx);await ctx.startAdminRosterWatch();assert.equal(calls.subscribe.length,0);});

test('disabled quick registration still catches up historical entrants',async()=>{
 const {ctx,calls}=harness();ctx.state.meta.registrationEnabled=false;ctx.remote.meta.registrationEnabled=false;
 ctx.manualSync();await tick();assert.equal(calls.catchup,1);assert.equal(calls.read,1);assert.equal(calls.save,0);assert.equal(ctx.state.players.length,2);
 await ctx.startAdminRosterWatch();assert.equal(calls.subscribe.length,1);
});

test('pending quick draw catches up authority without a client roster write',async()=>{
 const {ctx,calls}=harness();ctx.state.bracketSize=2;ctx.state.matches=[{id:'m',a:{playerId:'host-player'},b:{playerId:'online-r'}}];
 await ctx.syncLatestOnlineRosterBeforeLock();assert.equal(calls.catchup,1);assert.equal(calls.read,1);assert.equal(calls.save,0);
});

for(const stage of ['connect','catchup','read'])test('navigation during '+stage+' discards stale work and unsubscribes',async()=>{
 const {ctx,calls}=harness(),pending=deferred();
 if(stage==='connect')ctx.window.cloudSync.connect=()=>pending.promise;
 if(stage==='catchup')ctx.window.cloudSync.syncCommunityRegistrationSummary=()=>{calls.catchup++;return pending.promise;};
 if(stage==='read')ctx.window.cloudSync.joinRoom=()=>{calls.read++;return pending.promise;};
 const start=ctx.startAdminRosterWatch();if(stage!=='connect'){await start;calls.subscribe[0].next([{registrationId:'r',status:'confirmed'}]);}
 await tick();ctx.communityRoomActiveTab='live';ctx.reconcileRegistrationRosterContext();
 pending.resolve(stage==='read'?{ok:true,data:clone(ctx.remote)}:{ok:true});await start;await ctx.drainRoster();
 assert.equal(ctx.state.players.length,1);assert.equal(ctx.adminRegistrationsCache,null);assert.equal(calls.save,0);assert.equal(calls.unsub,stage==='connect'?0:1);
 if(stage==='catchup')assert.equal(calls.read,0,'stale catchup cannot start a private read');
 if(stage==='connect')assert.equal(calls.subscribe.length,0,'stale connect cannot create a listener');
});

test('room, auth and away/back navigation invalidate delayed registration reads',async()=>{
 for(const changed of ['room','account','away-back']){
 const {ctx,calls}=harness(),pending=deferred();ctx.window.cloudSync.listRegistrationsForAdmin=()=>{calls.list++;return pending.promise;};
 const load=ctx.loadAdminRegistrationRows();await tick();
 if(changed==='room'){ctx.state={...ctx.state,id:'room-b',cloudCode:'ROOM-B'};}
 else if(changed==='account'){ctx.firebaseUser={uid:'other'};}
 else {ctx.communityRoomActiveTab='live';ctx.reconcileRegistrationRosterContext();ctx.communityRoomActiveTab='people';}
 ctx.reconcileRegistrationRosterContext();pending.resolve([{registrationId:'private-old-room'}]);await load;
 assert.equal(ctx.adminRegistrationsCache,null,changed);assert.equal(ctx.adminRegistrationsLoading,false,changed);
 }
});

test('late snapshot and old readback cannot regress newer roster revisions',async()=>{
 const {ctx,calls}=harness(),pending=deferred();ctx.window.cloudSync.joinRoom=()=>pending.promise;
 await ctx.startAdminRosterWatch();calls.subscribe[0].next([{registrationId:'r',status:'confirmed'}]);await tick();
 ctx.state.registrationRosterRevision=8;ctx.state.players.push({id:'newest',source:'online'});
 pending.resolve({ok:true,data:clone(ctx.remote)});await ctx.drainRoster();
 assert.equal(ctx.state.registrationRosterRevision,8);assert.equal(ctx.state.players[1].id,'newest');
 ctx.appPhase='player-center';ctx.reconcileRegistrationRosterContext();calls.subscribe[0].next([{registrationId:'stale'}]);await ctx.drainRoster();assert.equal(ctx.adminRegistrationsCache,null);
});

test('newer queued snapshot supersedes the old snapshot before catchup starts',async()=>{
 const {ctx,calls}=harness();await ctx.startAdminRosterWatch();const next=calls.subscribe[0].next;
 next([{registrationId:'old',status:'confirmed'}]);next([{registrationId:'new',status:'confirmed'}]);await ctx.drainRoster();
 assert.equal(calls.catchup,1);assert.equal(calls.read,1);assert.equal(ctx.adminRegistrationsCache[0].registrationId,'new');
});

for(const stage of ['catchup','read'])test('failed '+stage+' keeps existing roster and shows retryable manual-sync error',async()=>{
 const {ctx,calls}=harness();const before=clone(ctx.state);
 if(stage==='catchup')ctx.window.cloudSync.syncCommunityRegistrationSummary=async()=>{throw new Error('unavailable');};
 else ctx.window.cloudSync.joinRoom=async()=>({ok:false,reason:'network'});
 ctx.manualSync();await tick();assert.deepEqual(clone(ctx.state),before);assert(ctx.adminRegistrationsError);assert.equal(ctx.peopleRosterBusy,false);assert(calls.toasts.some(row=>row.error));assert.equal(calls.save,0);
 ctx.window.cloudSync.syncCommunityRegistrationSummary=async()=>({ok:true,communityParticipantCount:2});ctx.window.cloudSync.joinRoom=async()=>({ok:true,data:clone(ctx.remote)});
 ctx.manualSync();await tick();assert.equal(ctx.state.players.length,2);assert.equal(ctx.adminRegistrationsError,null);assert.equal(ctx.peopleRosterBusy,false);
});

test('manual repeated clicks issue one catchup and stale completion cannot toast over a new room',async()=>{
 const {ctx,calls}=harness(),pending=deferred();ctx.window.cloudSync.syncCommunityRegistrationSummary=()=>{calls.catchup++;return pending.promise;};
 const target={};ctx.manualSync(target);ctx.manualSync(target);await tick();assert.equal(calls.catchup,1);assert.equal(target.disabled,true);
 ctx.state={...ctx.state,id:'room-b',cloudCode:'ROOM-B'};ctx.reconcileRegistrationRosterContext();pending.resolve({ok:true});await tick();
 assert.equal(ctx.peopleRosterBusy,false);assert.equal(calls.toasts.length,0);assert.equal(calls.read,0);assert.equal(target.disabled,false);
});

test('backend-managed official rosters are read back without browser reconstruction',async()=>{
 const {ctx,calls}=harness();ctx.currentRole='admin';ctx.userProfile.role='admin';ctx.state.meta.eventAuthority='official';ctx.remote.meta.eventAuthority='official';ctx.appPhase='app';ctx.activeTab='people';
 ctx.window.cloudSync.getPublicTournamentFull=async()=>({registrationRosterSyncBackendEnabled:true});await ctx.syncLatestOnlineRosterBeforeLock();
 assert.equal(calls.catchup,0);assert.equal(calls.list,0);assert.equal(calls.save,0);assert.equal(ctx.state.players.length,2);
});

test('owner action allowlist and rendered error retry stay connected to production controls',()=>{
 assert(block('const COMMUNITY_OWNER_ACTIONS = new Set([','const COMMUNITY_OWNER_TIER_ACTIONS').includes('"load-online-roster"'));
 assert.match(fn('renderPeopleManagement'),/role="alert"/);assert.match(fn('renderPeopleManagement'),/重新同步名單/);
 assert.match(fn('render'),/reconcileRegistrationRosterContext\(\)/);
 assert.match(block('  if(action==="community-exit-room"){','  if(action==="community-copy-code")'),/stopAdminRosterWatch\(\)/);
});

function startHarness(){
 const h=harness(),{ctx,calls}=h;calls.modals=[];
 ctx.communityRoomActiveTab='bracket';
 ctx.state.players=[{id:'p1',name:'One',source:'online',checkedIn:true},{id:'p2',name:'Two',source:'online',checkedIn:true}];
 ctx.state.bracketSize=2;ctx.state.matches=[{id:'m',a:{type:'player',playerId:'p1'},b:{type:'player',playerId:'p2'},status:'ready'}];
 ctx.remote=clone(ctx.state);
 Object.assign(ctx,{eligiblePlayers:()=>ctx.state.players,sameStringSet:(a,b)=>a.size===b.size&&[...a].every(id=>b.has(id)),scheduledTournamentStartMs:()=>null,openModal:modal=>calls.modals.push(modal),rebuildCourtAssignments:()=>{},BATTLE_MODE_LABELS:{individual:'individual'},FORMAT_LABELS:{},PLAY_MODE_LABELS:{}});
 for(const name of ['currentBracketParticipantIds','eligibleRosterIds','bracketRosterIsCurrent'])vm.runInContext(fn(name),ctx);
 vm.runInContext('function startTournament(){const action="start-tournament";'+block('  if(action==="start-tournament"){','  if(action==="reset-bracket"){')+'}',ctx);
 return h;
}

test('current pending draw starts from the COMMUNITY bracket tab after both authoritative checks',async()=>{
 const {ctx,calls}=startHarness(),matches=JSON.stringify(ctx.state.matches);
 ctx.startTournament();await tick();assert.equal(calls.modals.length,1);assert.equal(calls.modals[0].title,'確認開始賽事');
 calls.modals[0].onConfirm();await tick();assert(ctx.state.startedAt);assert.equal(calls.catchup,2);assert.equal(calls.save,1);assert.equal(JSON.stringify(ctx.state.matches),matches);
});

test('cancelled entrant in pending draw forces regeneration and preserves existing matches',async()=>{
 const {ctx,calls}=startHarness(),matches=JSON.stringify(ctx.state.matches);
 ctx.remote.players.pop();ctx.remote.registrationRosterRevision=1;ctx.remote.updatedAt=10;
 ctx.startTournament();await tick();assert.equal(calls.modals.length,1);assert.equal(calls.modals[0].title,'參賽名單已更新，請重新產生對戰表');
 assert.equal(calls.save,0);assert(!ctx.state.startedAt);assert.equal(JSON.stringify(ctx.state.matches),matches);
});

test('roster changed while start confirmation was open blocks the final start',async()=>{
 const {ctx,calls}=startHarness(),matches=JSON.stringify(ctx.state.matches);
 ctx.startTournament();await tick();ctx.remote.players.pop();ctx.remote.registrationRosterRevision=1;ctx.remote.updatedAt=10;
 calls.modals[0].onConfirm();await tick();assert(!ctx.state.startedAt);assert.equal(calls.save,0);assert(calls.toasts.some(row=>row.error&&/名單又有異動/.test(row.message)));assert.equal(JSON.stringify(ctx.state.matches),matches);
});

test('a pending old room read cannot hold the next room listener behind it',async()=>{
 const {ctx,calls}=harness(),oldRead=deferred();
 ctx.window.cloudSync.joinRoom=code=>code==='ROOM-A'?oldRead.promise:Promise.resolve({ok:true,data:clone(ctx.remote)});
 await ctx.startAdminRosterWatch();calls.subscribe[0].next([{registrationId:'old'}]);await tick();
 ctx.state={...ctx.state,id:'room-b',cloudCode:'ROOM-B'};ctx.remote={...clone(ctx.state),updatedAt:10,registrationRosterRevision:2,players:[{id:'new-room-player',name:'New room',source:'online'}]};
 ctx.reconcileRegistrationRosterContext();await ctx.startAdminRosterWatch();calls.subscribe[1].next([{registrationId:'new-room'}]);await ctx.drainRoster();
 assert.equal(ctx.state.players[0].id,'new-room-player');assert.equal(ctx.adminRegistrationsCache[0].registrationId,'new-room');
 oldRead.resolve({ok:true,data:{id:'room-a',players:[{id:'stale'}]}});await tick();assert.equal(ctx.state.players[0].id,'new-room-player');
});

test('disabled quick room shows one authoritative waitlist row and visible sync retry error',()=>{
 const {ctx}=harness();ctx.state.meta.registrationEnabled=false;
 ctx.state.waitlistPlayers=[{id:'shadow',registrationId:'waiting',source:'online',name:'Waiter'}];ctx.adminRegistrationsCache=[{registrationId:'waiting',status:'waitlist',publicName:'Waiter'}];ctx.adminRegistrationsError='offline';
 Object.assign(ctx,{setTimeout(){},esc:value=>String(value??''),peopleRosterSection:'waitlist',participantDisplayName:p=>p.name,normalizeDateTime:()=>0,renderStaffAssignmentPanel:()=>'',renderRefereeStationAssignmentPanel:()=>'',BATTLE_MODE_LABELS:{},FORMAT_LABELS:{},entryRosterValid:()=>true,renderEntrySelection:()=>''});
 for(const name of ['peopleRosterMutationLocked','peopleRegistrationSelectionManaged','peopleLocalWaitlist','peopleRegistrationIdOf','peopleOnlineWaitlistRows','peopleWaitlistShadow','renderPeopleManagement'])vm.runInContext(fn(name),ctx);
 const html=ctx.renderPeopleManagement();assert.match(html,/備取區（1）/);assert.match(html,/role="alert"/);assert.match(html,/線上名單尚未同步：offline/);assert.match(html,/data-action="load-online-roster"/);
});

test('existing admin and super-admin community access remains read-only with respect to owner catchup',async()=>{
 for(const role of ['admin','super_admin']){
 const {ctx,calls}=harness();ctx.currentRole='admin';ctx.userProfile.role=role;ctx.firebaseUser.uid='administrator';ctx.appPhase='app';ctx.activeTab='people';
 await ctx.startAdminRosterWatch();assert.equal(calls.subscribe.length,1,role);calls.subscribe[0].next([{registrationId:'r',status:'confirmed'}]);await ctx.drainRoster();
 assert.equal(calls.catchup,0,role);assert.equal(calls.save,0,role);assert.equal(ctx.state.players.length,2,role);
 ctx.manualSync();await tick();assert.equal(calls.catchup,0,role);assert.equal(calls.save,0,role);
 }
});

test('failed initial registration query settles to retryable error instead of restarting loading',async()=>{
 const {ctx}=harness();ctx.window.cloudSync.listRegistrationsForAdmin=async()=>{throw Error('network');};
 await ctx.loadAdminRegistrationRows();assert.equal(ctx.adminRegistrationsLoading,false);assert.equal(ctx.adminRegistrationsError,'network');assert.deepEqual(Array.from(ctx.adminRegistrationsCache),[]);
});

test('a delayed manual query cannot replace registrations already advanced by the listener',async()=>{
 const {ctx,calls}=harness(),pending=deferred();await ctx.startAdminRosterWatch();
 ctx.window.cloudSync.listRegistrationsForAdmin=()=>pending.promise;const load=ctx.loadAdminRegistrationRows();await tick();
 calls.subscribe[0].next([{registrationId:'latest',status:'confirmed'}]);await ctx.drainRoster();pending.resolve([{registrationId:'stale'}]);await load;
 assert.equal(ctx.adminRegistrationsCache[0].registrationId,'latest');assert.equal(ctx.adminRegistrationsLoading,false);
});
