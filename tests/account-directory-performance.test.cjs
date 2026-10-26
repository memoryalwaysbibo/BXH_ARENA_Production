'use strict';
// Exercise the production renderer and cloud methods against private in-memory
// fixtures. These tests never connect to Firebase or modify a real account.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');
const utils=fs.readFileSync(path.join(root,'modules/main-app/account-utils.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function ui(){
  let renders=0;
  const ctx={window:{},document:{querySelectorAll:()=>[],querySelector:()=>null},setTimeout:()=>0,Date,Intl,Map,Set,
    currentAuthUid:()=>ctx.actor,isSuperAdmin:()=>ctx.allowed,actor:'admin-a',allowed:true,engagementSessionEpoch:1,
    accountMgmtUsers:[],accountMgmtRoleFilter:'all',accountMgmtQuery:'',accountMgmtStatusFilter:'all',accountMgmtActivityFilter:'all',accountMgmtSort:'created-desc',
    appPhase:'account-management',superAdminManagementPage:'accounts',partnerPlansState:{plans:null,loading:false},
    authFormError:'',accountMgmtBusy:false,legacyPublicDocsPreview:null,legacyCleanupResult:null,legacyCleanupBusy:false,
    LOGO_SRC:'logo',APP_VERSION:'test',esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    topbarConnectionRailHtml:()=>'',accountMenuHtml:()=>'',accountMenuOverlayHtml:()=>'',renderSuperAdminManagementTabs:()=>'',renderModal:()=>'',
    roleDisplayLabel:r=>r,managedAccountDraft:u=>({role:u.role,isTestAccount:false,active:u.active!==false}),managedAccountPatch:()=>({}),
    renderPartnerContractCard:()=>'<textarea class="partner-contract-terms"></textarea>',
    accountBatchContext:()=>({selected:new Set(),busy:false}),renderAccountBatchPanel:()=>'',render:()=>renders++};
  vm.createContext(ctx);vm.runInContext(utils,ctx);Object.assign(ctx,ctx.window.BXHAccountUtils);
  vm.runInContext(between(core,'const ACCOUNT_ROLE_FILTERS = [','\nfunction renderAdminSetupScreen(){'),ctx);
  vm.runInContext(between(core,'function legacyPartnerRevocationPatch(user){','function renderPartnerContractCard(user){'),ctx);
  vm.runInContext(between(core,'function renderAccountManagementScreen(){','\nfunction renderPlayerHomeScreen(){'),ctx);
  ctx.window.cloudAuth={listUsers:()=>{throw Error('unbounded read forbidden');},getManagedAccountSummary:async progress=>{const s={total:908,enabled:907,daily:246,weekly:508,testers:0,roles:{all:908,player:900},errors:[]};progress(s);return s;},queryManagedAccounts:async()=>({users:[],truncated:false})};
  return {ctx,run:s=>vm.runInContext(s,ctx),view:()=>ctx.renderAccountManagementScreen(),renders:()=>renders};
}
const fixture=Array.from({length:908},(_,i)=>({uid:'user-'+i,realName:'玩家'+i,role:'player',email:'u'+i+'@test.invalid',createdAt:i,lastLoginAt:Date.now(),active:true}));
test('statistics-only entry builds zero account cards or contract forms and never lists all users',async()=>{
 const t=ui();t.ctx.accountMgmtUsers=fixture;
 let html=t.view();assert.equal((html.match(/class="account-user-card"/g)||[]).length,0);assert.doesNotMatch(html,/partner-contract-terms/);
 await t.ctx.loadAccountDirectorySummary();html=t.view();assert.match(html,/data-account-stat="total">908/);assert.equal(t.renders(),0,'partial statistics patch numbers, never rerender search/forms');
 assert.doesNotMatch(html,/data-account-uid=/);
});
test('even an oversized query response renders 30 summaries and creates details only when opened',async()=>{
 const t=ui();t.ctx.window.cloudAuth.queryManagedAccounts=async()=>({users:fixture,truncated:true});
 await t.ctx.searchAccountDirectory();let html=t.view();
 assert.equal((html.match(/class="account-user-card"/g)||[]).length,30);assert.doesNotMatch(html,/class="account-user-detail"/);assert.match(html,/部分結果/);
 t.run("accountDirectoryContext().opened.add('user-907')");html=t.view();
 assert.equal((html.match(/class="account-user-detail"/g)||[]).length,1);assert.equal((html.match(/partner-contract-terms/g)||[]).length,1);
 t.run('accountDirectoryContext().page=1');html=t.view();assert.equal((html.match(/class="account-user-card"/g)||[]).length,30);assert.doesNotMatch(html,/data-account-uid="user-907"/);
});
test('clear, newer search, identity change and privilege loss reject delayed private results',async()=>{
 for(const change of ['clear','new-search','actor','privilege','navigation']){
  const t=ui(),old=deferred();t.ctx.window.cloudAuth.queryManagedAccounts=()=>old.promise;
  const request=t.ctx.searchAccountDirectory();
  if(change==='clear')t.ctx.resetAccountDirectorySearch();
  if(change==='new-search'){t.ctx.window.cloudAuth.queryManagedAccounts=async()=>({users:[{uid:'new',realName:'New',role:'player'}]});await t.ctx.searchAccountDirectory();}
  if(change==='actor'){t.ctx.actor='admin-b';t.ctx.accountDirectoryContext();}
  if(change==='privilege')t.ctx.allowed=false;
  if(change==='navigation'){t.ctx.appPhase='app';t.ctx.accountMgmtUsers=[{uid:'staff-directory'}];}
  old.resolve({users:[{uid:'private-old'}],truncated:false});await request;
  assert.ok(!t.ctx.accountMgmtUsers.some(u=>u.uid==='private-old'),change);
 }
});
test('cloud failure is visible and is never represented as a successful empty result',async()=>{
 const t=ui();t.ctx.window.cloudAuth.queryManagedAccounts=async()=>{throw Error('permission-denied');};
 await t.ctx.searchAccountDirectory();assert.match(t.view(),/查詢失敗或逾時/);assert.doesNotMatch(t.view(),/沒有符合目前條件的帳號/);
});
function cloudHarness(rows){
 const reads=[],aggregates=[];
 const field=(o,k)=>k.split('.').reduce((a,p)=>a?.[p],o);
 const matches=(row,f)=>f.type==='or'?f.filters.some(x=>matches(row,x)):f.op==='=='?field(row,f.key)===f.value:f.op==='in'?f.value.includes(field(row,f.key)):f.op==='>='?field(row,f.key)>=f.value:field(row,f.key)<=f.value;
 const select=q=>rows.filter(r=>(q.filters||[]).every(f=>matches(r,f))).sort((a,b)=>q.order?String(field(a,q.order)).localeCompare(String(field(b,q.order))):0).slice(0,q.limit||Infinity);
 const snapshot=records=>({docs:records.map(r=>({id:r.uid,data:()=>({...r}),exists:()=>true}))});
 const fx={collection:()=>({collection:true}),where:(key,op,value)=>({key,op,value}),or:(...filters)=>({type:'or',filters}),orderBy:key=>({order:key}),limit:n=>({limit:n}),
  query:(collection,...parts)=>({collection,filters:parts.filter(x=>x.key||x.type),order:parts.find(x=>x.order)?.order,limit:parts.find(x=>x.limit)?.limit}),
  getDocs:async q=>{reads.push(q);assert.ok(q.filters?.length||q.limit,'never download the whole collection');return snapshot(select(q));},
  getCountFromServer:async q=>{aggregates.push(q);return {data:()=>({count:select(q).length})};},
  doc:(_db,_col,id)=>({id}),getDoc:async ref=>{const row=rows.find(r=>r.uid===ref.id);return {id:ref.id,exists:()=>!!row,data:()=>row};}};
 const ctx={authReady:true,fx,dbHandle:{},USERS_COLLECTION:'users',Date,Map,Set,console,withTimeout:async(p,_ms,fallback)=>{try{return await p;}catch{return fallback;}}};
 vm.createContext(ctx);vm.runInContext('service=({'+between(cloud,'    async getManagedAccountSummary(','    async listUsers(){')+'})',ctx);
 return {ctx,reads,aggregates};
}
test('counts preserve legacy enabled/tester/partner semantics without downloading enabled players',async()=>{
 const now=Date.now(),h=cloudHarness([
  {uid:'a',role:'super_admin',lastLoginAt:now},
  {uid:'b',role:'player',active:true,lastLoginAt:now},
  {uid:'c',role:'player',active:false,lastLoginAt:now},
  {uid:'d',role:'player',isTestAccount:true,lastLoginAt:now-2*86400000},
  {uid:'e',role:'tester',isTestAccount:true,active:false,lastLoginAt:now-2*86400000},
  {uid:'f',role:'player',partnerOrganizer:{status:'active',expiresAt:now+86400000}},
  {uid:'g',role:'player',partnerOrganizer:{status:'active',expiresAt:now-1}}
 ]);
 const s=await h.ctx.service.getManagedAccountSummary();
 assert.equal(s.total,7);assert.equal(s.enabled,5);assert.equal(s.daily,2);assert.equal(s.weekly,3);assert.equal(s.testers,1);
 assert.equal(s.roles.player,4);assert.equal(s.roles.tester,2);assert.equal(s.roles.management,1);assert.equal(s.roles.partner_organizer,1);
 assert.equal(h.reads.length,2,'only disabled and authorized-partner subsets are read as documents');assert.ok(h.aggregates.length>0);
});
test('server search returns bounded indexed matches; large categories require a narrower query',async()=>{
 const h=cloudHarness(fixture);
 let result=await h.ctx.service.queryManagedAccounts({keyword:'玩家907'});
 assert.equal(result.users.length,1);assert.equal(result.users[0].uid,'user-907');assert.equal(result.truncated,false);
 result=await h.ctx.service.queryManagedAccounts({role:'player'});assert.equal(result.users.length,50);assert.equal(result.truncated,true);
 for(const read of h.reads)assert.ok(read.limit<=51,'each document query has a fixed upper bound');
});
test('incomplete counts keep unavailable values unknown and expose a retry state',async()=>{
 const h=cloudHarness(fixture);h.ctx.fx.getCountFromServer=async()=>{throw Error('unavailable');};
 const s=await h.ctx.service.getManagedAccountSummary();assert.equal(s.total,null);assert.equal(s.enabled,null);assert.ok(s.errors.includes('total'));
});
