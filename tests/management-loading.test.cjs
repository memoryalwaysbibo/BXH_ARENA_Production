'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
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
 firebaseUser:{uid:'owner'},userProfile:{role:'admin',active:true},currentRole:'admin',activeMode:'admin',state:{cloudCode:null},pendingModal:null,
 currentAuthUid:()=>s.firebaseUser?.uid||'',hasAdminAccess:()=>!!s.firebaseUser&&s.currentRole==='admin',isAdminTierOrAbove:()=>['admin','super_admin'].includes(s.userProfile?.role),isPartnerOrganizerMode:()=>s.activeMode==='partner_organizer',isEventStaffMode:()=>s.activeMode==='event_staff',partnerOrganizerGrant:()=>s.userProfile?.partnerOrganizer||{},cloudAvailable:()=>true,canCreateOfficialTournament:()=>false,
 registrationStatusLabel:status=>({open:'報名中',full:'額滿',scheduled:'即將開放',closed:'已關閉'})[status]||status,esc:value=>String(value??''),
 window:{cloudSync:{connect:async()=>true,queryAdminTournamentSummaries:request=>{calls.push(JSON.parse(JSON.stringify(request)));return query(request);},queryAdminTournaments:()=>{throw Error('full tournament downloads forbidden');},repairTournamentLifecycle:()=>{throw Error('list must not repair room state');},enrichAdminTournamentCreatorNames:()=>{throw Error('optional user-profile reads forbidden');}}},
 render(){s.reconcileAdminTournamentListContext();}};
 vm.createContext(s);vm.runInContext(source,s);const evaluate=code=>vm.runInContext(code,s);s.reconcileAdminTournamentListContext();
 return{s,calls,timer,evaluate,state:()=>JSON.parse(JSON.stringify(evaluate('({items:adminTournamentListItems,busy:adminTournamentListBusy,loaded:adminTournamentListLoaded,error:adminTournamentListError,cursor:adminTournamentListCursor,more:adminTournamentListHasMore,counts:adminTournamentListCounts,filter:adminTournamentListFilter,search:adminTournamentListSearch})'))),view:()=>s.renderTournamentManagementTab(),load:options=>s.loadAdminTournamentList(options),query:fn=>{query=fn;}};
}
test('initial view fetches only five summaries and remains idle until another explicit action',async()=>{
 const t=setup();await t.load();assert.equal(t.state().items.length,5);assert.equal(t.calls.length,1);assert.equal(t.calls[0].cursor,null);
 t.view();t.view();await t.timer.advance(60000);assert.equal(t.calls.length,1);assert.match(t.view(),/再載入 5 場/);assert.match(t.view(),/其餘尚未下載/);
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
 for(const label of ['報名中','即將開放','已關閉','草稿','一般房間','搜尋賽事名稱、房號或地點'])assert.match(controls,new RegExp(label));
 assert.doesNotMatch(controls,/我的賽事|其他賽事|全部賽事/);assert.match(controls,/報名中 <b>10<\/b>/);
});
test('staff cannot request the community-room scope from client controls',async()=>{
 const t=setup();t.s.userProfile.role='staff';await t.load();assert.doesNotMatch(t.s.adminTournamentListControlsHtml(),/data-action="admin-tournament-kind"/);
 const count=t.calls.length;await t.s.changeAdminTournamentListQuery({kind:'community'});assert.equal(t.calls.length,count);
});
