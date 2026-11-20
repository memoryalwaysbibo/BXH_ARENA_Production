'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const entryUtils=fs.readFileSync(path.join(__dirname,'../modules/main-app/tournament-entry-utils.js'),'utf8');
function between(start,end){const a=core.indexOf(start),b=core.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return core.slice(a,b);}
const source=between('let adminTournamentListOpen = false;','let refereeDirectoryUsers = null;')+'\n'
 +between('function renderTournamentManagementTab(){','\nfunction renderAdminNoTournamentScreen(){');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{resolve,reject,promise};}
function clock(){let time=0,id=0;const timers=new Map();return{setTimeout(fn,delay=0){const key=++id;timers.set(key,{at:time+delay,fn});return key;},clearTimeout:key=>timers.delete(key),async advance(ms){const end=time+ms;await tick();for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await tick();}time=end;await tick();}};}
const row=(i=0,extra={})=>({code:'BXH-'+String(i).padStart(6,'0'),name:'Room '+i,eventDate:'2026-11-01',createdBy:'owner',createdByName:'Creator',eventAuthority:'official',registrationStatus:'open',registrationEnabled:true,tournamentPhase:'waiting',archiveStatus:'ongoing',...extra});
const page=(start=0,size=5,hasMore=true)=>({ok:true,items:Array.from({length:size},(_,i)=>row(start+i)),pageSize:5,hasMore,nextCursor:hasMore?'cursor-'+(start+size):null,counts:{all:13,open:10,upcoming:2,closed:1,draft:0}});
function setup(query=async()=>page()){
 const timer=clock(),calls=[];const s={console:{log(){},warn(){}},setTimeout:timer.setTimeout,clearTimeout:timer.clearTimeout,
 firebaseUser:{uid:'owner'},userProfile:{role:'admin',active:true},currentRole:'admin',activeMode:'admin',appPhase:'app',activeTab:'management',document:{hidden:false,addEventListener(){}},state:{cloudCode:null},pendingModal:null,
 currentAuthUid:()=>s.firebaseUser?.uid||'',hasAdminAccess:()=>!!s.firebaseUser&&s.currentRole==='admin',isAdminTierOrAbove:()=>['admin','super_admin'].includes(s.userProfile?.role),isPartnerOrganizerMode:()=>s.activeMode==='partner_organizer',isEventStaffMode:()=>s.activeMode==='event_staff',partnerOrganizerGrant:()=>s.userProfile?.partnerOrganizer||{},cloudAvailable:()=>true,canCreateOfficialTournament:()=>false,
 registrationStatusLabel:status=>({open:'報名中',full:'額滿',scheduled:'即將開放',closed:'已關閉'})[status]||status,esc:value=>String(value??''),
 window:{cloudSync:{connect:async()=>true,queryAdminTournamentSummaries:request=>{calls.push(JSON.parse(JSON.stringify(request)));return query(request);},queryAdminTournaments:()=>{throw Error('full tournament downloads forbidden');},repairTournamentLifecycle:()=>{throw Error('list must not repair room state');},enrichAdminTournamentCreatorNames:()=>{throw Error('optional user-profile reads forbidden');}}},
 render(){s.reconcileAdminTournamentListContext();}};
 vm.createContext(s);vm.runInContext(entryUtils,s);s.isValidRoomCode=s.window.BXHTournamentEntryUtils.isValidRoomCode;
 vm.runInContext(source,s);const evaluate=code=>vm.runInContext(code,s);s.reconcileAdminTournamentListContext();
 return{s,calls,timer,evaluate,state:()=>JSON.parse(JSON.stringify(evaluate('({items:adminTournamentListItems,busy:adminTournamentListBusy,loaded:adminTournamentListLoaded,error:adminTournamentListError,cursor:adminTournamentListCursor,more:adminTournamentListHasMore,counts:adminTournamentListCounts,filter:adminTournamentListFilter,search:adminTournamentListSearch})'))),view:()=>s.renderTournamentManagementTab(),load:options=>s.loadAdminTournamentList(options),query:fn=>{query=fn;}};
}
test('management cards refresh their counts while visible without downloading full rooms',async()=>{
 const t=setup();await t.load();assert.equal(t.state().items.length,5);assert.equal(t.calls.length,1);assert.equal(t.calls[0].cursor,null);
 t.view();t.view();await t.timer.advance(30000);assert.equal(t.calls.length,2);assert.match(t.view(),/再載入 5 場/);assert.match(t.view(),/其餘尚未下載/);
});
test('background refresh updates a six-room list without losing the second page',async()=>{
 let count=2;
 const t=setup(async request=>{
   const result=request.cursor?page(5,1,false):page();
   result.items=result.items.map(item=>item.code==='BXH-000005'?{...item,confirmedCount:count,capacity:60}:item);
   return result;
 });
 await t.load();await t.load({append:true});t.view();count=3;
 await t.timer.advance(30000);
 assert.equal(t.state().items.length,6);assert.equal(t.state().items[5].confirmedCount,3);
 assert.equal(t.calls.at(-2).cursor,null);assert.equal(t.calls.at(-1).cursor,'cursor-5');
 assert.match(t.view(),/3 \/ 60/);assert.equal(t.state().more,false);
});
test('background refresh pauses when management is hidden',async()=>{
 const t=setup();await t.load();t.view();t.s.document.hidden=true;
 await t.timer.advance(30000);assert.equal(t.calls.length,1);
});
test('multiple initial render callbacks cannot refetch an already completed first page',async()=>{
 const t=setup();t.view();t.view();t.view();await t.timer.advance(0);assert.equal(t.calls.length,1);assert.equal(t.state().items.length,5);
});
test('each explicit expansion requests one next page and appends at most five rows',async()=>{
 const t=setup(request=>Promise.resolve(request.cursor?page(5,5,false):page()));await t.load();await t.load({append:true});
 assert.equal(t.calls.length,2);assert.equal(t.calls[1].cursor,'cursor-5');assert.equal(t.state().items.length,10);assert.equal(t.state().more,false);
 await t.load({append:true});assert.equal(t.calls.length,2);assert.doesNotMatch(t.view(),/data-action="admin-tournament-load-more"/);
});
test('a failed expansion preserves the five existing cards and cursor, and retries only that page',async()=>{
 const t=setup();await t.load();const pending=deferred();t.query(()=>pending.promise);
 const load=t.load({append:true});await t.timer.advance(10000);await load;
 assert.equal(t.state().items.length,5);assert.equal(t.state().cursor,'cursor-5');assert.equal(t.state().busy,false);assert.match(t.view(),/重試載入 5 場/);
 t.query(async()=>page(5,5,false));await t.load({append:true});assert.equal(t.calls[2].cursor,'cursor-5');assert.equal(t.state().items.length,10);assert.equal(t.state().error,'');
 pending.resolve(page(100));await tick();assert.equal(t.state().items.length,10);
});
test('repeated expansion clicks share one pending request',async()=>{
 const t=setup();await t.load();const pending=deferred();t.query(()=>pending.promise);
 const a=t.load({append:true}),b=t.load({append:true});assert.equal(a,b);await tick();assert.equal(t.calls.length,2);
 pending.resolve(page(5));await a;
});
test('switching a status starts at page one and never mixes the previous category',async()=>{
 const t=setup();await t.load();t.query(async()=>page(20,2,false));await t.s.changeAdminTournamentListQuery({status:'upcoming'});
 assert.equal(t.calls[1].status,'upcoming');assert.equal(t.calls[1].cursor,null);assert.equal(t.state().items.length,2);assert.equal(t.state().items[0].name,'Room 20');
});
test('search is sent to the backend, resets pagination and is independent of loaded cards',async()=>{
 const t=setup();await t.load();t.query(async()=>page(50,1,false));await t.s.changeAdminTournamentListQuery({search:'雪山貓'});
 assert.equal(t.calls[1].search,'雪山貓');assert.equal(t.calls[1].cursor,null);assert.equal(t.state().items[0].name,'Room 50');assert.match(t.view(),/雪山貓/);
});
for(const change of ['account','role','mode','contract'])test(change+' change discards a pending response and cached cursors',async()=>{
 const t=setup();await t.load();const pending=deferred();t.query(()=>pending.promise);const request=t.load({append:true});await tick();
 if(change==='account')t.s.firebaseUser={uid:'another'};
 if(change==='role')t.s.userProfile.role='staff';
 if(change==='mode')t.s.activeMode='event_staff';
 if(change==='contract')t.s.userProfile.partnerOrganizer={organizationId:'org',orderCode:'different'};
 t.s.reconcileAdminTournamentListContext();pending.resolve(page(5));await request;
 assert.equal(t.state().items.length,0);assert.equal(t.state().cursor,null);assert.equal(t.state().more,false);
});
test('old append cannot repopulate a newer search result',async()=>{
 const t=setup();await t.load();const pending=deferred();t.query(()=>pending.promise);const old=t.load({append:true});await tick();
 t.query(async()=>page(80,1,false));await t.s.changeAdminTournamentListQuery({search:'new'});pending.resolve(page(5));await old;
 assert.deepEqual(t.state().items.map(item=>item.name),['Room 80']);
});
test('refresh returns to five rows and removes deleted cached cards only after success',async()=>{
 const t=setup(request=>Promise.resolve(request.cursor?page(5):page()));await t.load();await t.load({append:true});assert.equal(t.state().items.length,10);
 const pending=deferred();t.query(()=>pending.promise);const refresh=t.load();await tick();assert.equal(t.state().items.length,10);
 pending.resolve(page(50,5,false));await refresh;assert.equal(t.state().items.length,5);assert.equal(t.state().items[0].name,'Room 50');assert.equal(t.calls.at(-1).cursor,null);
});
test('bad server responses never replace a usable list or trigger a full collection fallback',async()=>{
 const t=setup();await t.load();t.query(async()=>({...page(),items:Array.from({length:6},(_,i)=>row(i))}));await t.load();
 assert.equal(t.state().items.length,5);assert.ok(t.state().error);assert.equal(t.calls.length,2);
});
test('first-page errors are retryable and never claim that the category is empty',async()=>{
 const t=setup(async()=>{throw {code:'functions/permission-denied'};});await t.load();assert.match(t.view(),/權限/);assert.doesNotMatch(t.view(),/此分類目前沒有賽事/);
 t.query(async()=>page(0,0,false));await t.load();assert.match(t.view(),/此分類目前沒有賽事/);assert.equal(t.state().error,'');
});
test('connection timeout ends loading without requesting summaries',async()=>{
 const t=setup(),pending=deferred();t.s.window.cloudSync.connect=()=>pending.promise;
 const request=t.load();await t.timer.advance(10000);await request;assert.equal(t.calls.length,0);assert.equal(t.state().busy,false);assert.match(t.state().error,/逾時/);
});
test('primary controls use status tabs and search rather than owner tabs; draft and community remain available',async()=>{
 const t=setup();await t.load();const controls=t.s.adminTournamentListControlsHtml();
 for(const label of ['報名中','即將開放','開賽中','已結束','報名已關閉','草稿','一般房間','搜尋賽事名稱、房號或地點'])assert.match(controls,new RegExp(label));
 assert.doesNotMatch(controls,/我的賽事|其他賽事|全部賽事/);assert.match(controls,/報名中 <b>10<\/b>/);
});
test('active staff can request the community-room scope from client controls',async()=>{
 const t=setup();Object.assign(t.s.userProfile,{role:'staff',active:true});await t.load();
 assert.match(t.s.adminTournamentListControlsHtml(),/data-action="admin-tournament-kind"/);
 await t.s.changeAdminTournamentListQuery({kind:'community'});
 assert.equal(t.calls.at(-1).kind,'community');
});
test('community room cards expose management entry to admins and active staff',async()=>{
 for(const role of ['admin','staff']){
  const t=setup(async()=>({...page(0,1,false),items:[row(0,{code:'BXH-HBWFHS',eventAuthority:'community'})]}));
  t.s.userProfile.role=role;
  await t.s.changeAdminTournamentListQuery({kind:'community'});
  assert.match(t.view(),/data-action="cloud-admin-open-tournament" data-code="BXH-HBWFHS">進入管理/);
 }
});

function navigationSetup(){
 const t=setup(),values=new Map();
 Object.assign(t.s,{localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},guestReadOnlyMode:false,
  publicWatchReturnContext:null,publicWatchUsesPrivateData:false,cloudStatus:'connected',showToast(){},
  CODE_ENTRY_ERROR_MESSAGES:{forbidden:'無權限'},refereeResumeFocus:()=>null,
  getTournamentEntryFromUrl:()=>null,pendingRegistrationCode:null,
  rebuildCourtAssignments(){},courtKey:n=>'court'+n,getMatch:id=>t.s.state.matches?.find(m=>m.id===id),
  canOperateStation:()=>true,
  previewTournamentByCode:async code=>({ok:true,code,usePublic:false,rawData:{cloudCode:code,meta:{registrationEnabled:true},matches:[],courtAssignments:{}}}),
  commitJoinedTournamentData:async(code,data,publicView,options)=>{if(options?.isCurrent?.()===false)return;t.s.state={...data,cloudCode:code};}});
 return {...t,values,entry:(code,options)=>t.s.openManagedTournament(code,options),saved:()=>t.s.readManagedRoomRecord()};
}
test('only successful management entry replaces the scoped pointer; viewing another room does not',async()=>{
 const t=navigationSetup();await t.entry('BXH-AAAAAA');assert.equal(t.saved().code,'BXH-AAAAAA');
 t.s.state.cloudCode='BXH-BBBBBB';t.s.rememberManagedRoomView();assert.equal(t.saved().code,'BXH-AAAAAA');
 t.s.previewTournamentByCode=async()=>({ok:false,reason:'forbidden'});await t.entry('BXH-CCCCCC');assert.equal(t.saved().code,'BXH-AAAAAA');assert.match(t.view(),/返回上次管理/);
 t.s.firebaseUser={uid:'other'};assert.equal(t.saved(),null);
});
test('a managed PTN room keeps its resume pointer',async()=>{
 const t=navigationSetup();await t.entry('PTN-ABC123');assert.equal(t.saved().code,'PTN-ABC123');
});
test('reload re-reads the saved room from cloud and restores its tab and current court match',async()=>{
 const t=navigationSetup();await t.entry('BXH-AAAAAA');t.s.activeTab='referee';t.s.refereeResumeFocus=()=>({station:3});t.s.rememberManagedRoomView();
 t.s.state={cloudCode:'BXH-BBBBBB'};let reads=0;
 t.s.previewTournamentByCode=async code=>{reads++;return{ok:true,code,usePublic:false,rawData:{meta:{},matches:[{id:'fresh',station:3,completed:false}],courtAssignments:{court3:{currentMatchId:'fresh'}}}};};
 assert.equal(await t.s.restoreLastManagedRoom('owner','admin',()=>true),true);
 assert.equal(reads,1);assert.equal(t.s.state.cloudCode,'BXH-AAAAAA');assert.equal(t.s.state.currentMatchId,'fresh');assert.equal(t.s.activeTab,'referee');
 assert.equal(await t.s.restoreLastManagedRoom('owner','admin',()=>true),false);
});
test('lost court permission restores the room on live view without retaining the old match',async()=>{
 const t=navigationSetup();await t.entry('BXH-AAAAAA');t.s.activeTab='referee';t.s.refereeResumeFocus=()=>({station:3});t.s.rememberManagedRoomView();
 t.s.canOperateStation=()=>false;await t.entry('BXH-AAAAAA',{resume:true});assert.equal(t.s.activeTab,'live');assert.equal(t.s.state.currentMatchId,undefined);
});
test('account changes during reconnect cannot commit the previous room or pointer',async()=>{
 const t=navigationSetup(),pending=deferred();t.s.previewTournamentByCode=()=>pending.promise;const request=t.entry('BXH-AAAAAA');await tick();
 t.s.firebaseUser={uid:'other'};pending.resolve({ok:true,code:'BXH-AAAAAA',usePublic:false,rawData:{meta:{}}});await request;
 assert.equal(t.s.state.cloudCode,null);assert.equal(t.values.size,0);
});
test('unavailable or public-only restored room falls back to the management list and preserves retry',async()=>{
 const t=navigationSetup();await t.entry('BXH-AAAAAA');
 t.s.previewTournamentByCode=async()=>({ok:true,code:'BXH-AAAAAA',usePublic:true});await t.s.restoreLastManagedRoom('owner','admin',()=>true);
 assert.equal(t.s.activeTab,'management');assert.ok(t.evaluate('adminTournamentListError'));assert.equal(t.saved().code,'BXH-AAAAAA');
});
test('history viewing and player mode cannot replace a managed room; card details stay collapsed',async()=>{
 const t=navigationSetup();await t.entry('BXH-AAAAAA');await t.entry('BXH-BBBBBB',{openHistory:true});assert.equal(t.saved().code,'BXH-AAAAAA');
 t.s.activeMode='player';assert.equal(t.saved(),null);t.s.activeMode='admin';await t.load();
 assert.match(t.view(),/class="management-card-details"/);assert.doesNotMatch(t.view(),/class="management-card-details"[^>]* open/);
});

// Settings-save navigation shares the management regression entrypoint.
{
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
function fn(name){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(core);assert(m,name);return core.slice(m.index,core.indexOf('\n}',m.index)+2);}
function rig(){
 const calls={toasts:[],queries:[],pins:0,frames:[],timers:[],renders:0,scrolls:0};
 const s={state:{id:'room',cloudCode:'BXH-ABC123',meta:{}},appPhase:'app',activeTab:'settings',activeMode:'admin',actor:'u1',
  tournamentSettingsSavedNotice:null,adminTournamentListOpen:true,viewingRecordId:'old',viewingRecordData:{},mainTabNavCenterRequested:false,
  currentAuthUid:()=>s.actor,hasAdminAccess:()=>true,saveRegistrationSettingsAndReport:async()=>true,
  rememberManagedRoomView(){calls.pins++;},changeAdminTournamentListQuery(q){calls.queries.push(q);return Promise.resolve();},
  render(){calls.renders++;},renderPreservingScroll(){calls.renders++;},showToast:m=>calls.toasts.push(m),
  requestAnimationFrame:f=>calls.frames.push(f),setTimeout:f=>calls.timers.push(f),document:{querySelectorAll:()=>[]},window:{scrollTo:()=>calls.scrolls++}};
 vm.createContext(s);vm.runInContext(['currentSettingsSavedNotice','locateSettingsSavedCard','saveTournamentSettingsAndReturn'].map(fn).join('\n'),s);
 return {s,calls,save:()=>s.saveTournamentSettingsAndReturn({},'saved')};
}
test('confirmed save returns to management, pins room and resets filters before refreshing summaries',async()=>{
 const {s,calls,save}=rig();assert.equal(await save(),true);assert.equal(s.activeTab,'management');assert.equal(calls.pins,1);
 assert.deepEqual(JSON.parse(JSON.stringify(calls.queries)),[{status:'all',kind:'official',search:''}]);
 assert.equal(s.tournamentSettingsSavedNotice.code,'BXH-ABC123');assert.equal(s.adminTournamentListOpen,false);assert.equal(s.viewingRecordId,null);
});
test('save stays on settings until acceptance; failure does not navigate or refresh',async()=>{
 const {s,calls,save}=rig();let finish;s.saveRegistrationSettingsAndReport=()=>new Promise(r=>finish=r);
 const pending=save();assert.equal(s.activeTab,'settings');assert.equal(calls.queries.length,0);finish(false);
 assert.equal(await pending,false);assert.equal(s.activeTab,'settings');assert.equal(s.tournamentSettingsSavedNotice,null);assert.equal(calls.queries.length,0);
});
test('new local draft remains on settings with a publication prompt',async()=>{
 const {s,calls,save}=rig();s.state.cloudCode=null;await save();assert.equal(s.activeTab,'settings');assert.match(calls.toasts.at(-1),/草稿已儲存.*發布/);assert.equal(calls.queries.length,0);
});
test('completion never pulls user back after room, identity, mode or tab changes',async()=>{
 for(const change of [s=>s.state={id:'other',cloudCode:'BXH-OTHER1'},s=>s.actor='u2',s=>s.activeMode='staff',s=>s.activeTab='people',s=>s.appPhase='player-center']){
  const {s,calls,save}=rig();let finish;s.saveRegistrationSettingsAndReport=()=>new Promise(r=>finish=r);const pending=save();change(s);finish(true);await pending;
  assert.equal(calls.queries.length,0);assert.equal(calls.pins,0);assert.equal(s.tournamentSettingsSavedNotice,null);
 }
});
test('admin-managed community event refreshes the matching management scope',async()=>{
 const {s,calls,save}=rig();s.state.meta.eventAuthority='community';await save();assert.equal(calls.queries[0].kind,'community');
});
test('court resize follows the same successful-save rule without issuing a second write',async()=>{
 const {s,calls}=rig();s.saveRegistrationSettingsAndReport=()=>{throw Error('duplicate save');};
 assert.equal(await s.saveTournamentSettingsAndReturn({},'saved',async()=>false),false);assert.equal(calls.queries.length,0);
 assert.equal(await s.saveTournamentSettingsAndReturn({},'saved',async()=>true),true);assert.equal(s.activeTab,'management');
});
test('fresh saved card is scrolled and focused once; fallback scroll cannot override its position',async()=>{
 const {s,calls,save}=rig();let scroll=0,focus=0;const card={getAttribute:()=>s.state.cloudCode,scrollIntoView:()=>scroll++,focus:()=>focus++};
 await save();s.document.querySelectorAll=()=>[card];s.locateSettingsSavedCard();
 calls.frames.pop()();calls.frames.shift()();assert.equal(scroll,1);assert.equal(focus,1);assert.equal(calls.scrolls,0);
 s.locateSettingsSavedCard();assert.equal(calls.frames.length,0);calls.timers.shift()();assert.equal(s.tournamentSettingsSavedNotice,null);
});
test('a delayed location callback cannot scroll another account or mode',async()=>{
 const {s,calls,save}=rig();await save();s.locateSettingsSavedCard();s.actor='other';for(const f of calls.frames)f();assert.equal(calls.scrolls,0);assert.equal(s.currentSettingsSavedNotice(),null);
});

}
