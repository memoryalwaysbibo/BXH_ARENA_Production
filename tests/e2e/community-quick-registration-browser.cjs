'use strict';
// Isolated Chromium integration smoke: real UI/actions/styles, in-memory persistence.
// All network requests are blocked; no production account or Firebase is used.
// Run from repo root: node tests/e2e/community-quick-registration-browser.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const core=read('modules/main-app/core.js');
function fn(name){
 const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(core);
 assert(match,'Missing production function '+name);const firstEnd=core.indexOf('\n',match.index);
 if(/\}\s*$/.test(core.slice(match.index,firstEnd)))return core.slice(match.index,firstEnd);
 const end=core.indexOf('\n}',match.index);assert(end>match.index,'Missing production function boundary '+name);
 return core.slice(match.index,end+2);
}
const saveStart=core.indexOf('  if(action==="community-save-settings"){');
const saveEnd=core.indexOf('  if(action==="toggle-lobby-section"){',saveStart);
assert(saveStart>=0&&saveEnd>saveStart,'Missing community settings action seam');
const manualStart=core.indexOf('  if(action==="load-online-roster"){'),manualEnd=core.indexOf('  if(action==="close-checkin-early"){',manualStart);
const watchStart=core.indexOf('let adminRosterUnsub=null, adminRosterCode="", adminRosterGeneration=0;'),watchEnd=core.indexOf('let myRegistrationsError = null;',watchStart);
const action='function handleFixtureAction(action,target){if(action==="people-section"){peopleRosterSection=target.dataset.section;render();return;}'+core.slice(saveStart,saveEnd)+core.slice(manualStart,manualEnd)+'}';
const rosterSource=core.slice(watchStart,watchEnd)+'\n'+['canManageOnsiteWaitlist','peopleOnsiteWaitlistManaged','peopleOnsiteWaitlistAvailable','hasAdminAccess','isCommunityRoom','isTester','syncLatestOnlineRosterBeforeLock','peopleRosterMutationLocked','peopleRegistrationSelectionManaged','peopleLocalWaitlist','peopleRegistrationIdOf','peopleOnlineWaitlistRows','peopleWaitlistShadow','renderPeopleManagement'].map(fn).join('\n');
const state={id:'fixture-room',cloudCode:'LOCAL-ONLY',ownerUid:'fixture-user',createdBy:'fixture-user',players:[],matches:[],startedAt:null,archiveStatus:'ongoing',meta:{name:'一般玩家的房間',date:'2026-10-05',location:'玩家即時對戰',startTime:'10:00',formatType:'single',format:'單淘汰賽',stations:1,eventAuthority:'community',ladderMode:'general',registrationEnabled:false,registrationStatus:'closed',registrationCapacity:16,waitlistCapacity:2,roomAccessMode:'public'}};
const bootstrap=`
window.fixture={state:${JSON.stringify(state)},cloud:null,local:null,saves:0,fail:false,toasts:[],screen:'settings'};
// about:blank fixture pages may omit secure-context randomUUID. Access calls stay local.
if(typeof window.crypto.randomUUID!=='function')window.crypto.randomUUID=()=> 'local-browser-access-operation';
let state=fixture.state,communitySettingsSaving=false,communitySettingsWriteGate=null,communityCreateSaving=false,cloudSyncPending=false,cloudSyncQueueTimer=null,cloudStatus='connected',cloudLastSyncAt=0,cloudAccessLimited=false,cloudAccessMessage='',currentRole='player';
let publicTournamentsCache=[],communityEventsCache=[],myRegistrationsCache=[];
let communitySettingsRenderedContext=null,communityRoomSnapshotGeneration=0;
let appPhase='community-room',communityRoomActiveTab='settings',activeTab='live',peopleRosterSection='confirmed',peopleRosterBusy=false;
let adminRegistrationsCache=null,adminRegistrationsLoading=false,adminRegistrationsError=null;
const resetAdminRegistrationsCache=()=>{adminRegistrationsCache=null;adminRegistrationsError=null;};
const participantDisplayName=p=>p.name,BATTLE_MODE_LABELS={individual:'個人戰'},entryRosterValid=()=>true,renderEntrySelection=()=>'',renderStaffAssignmentPanel=()=>'',renderRefereeStationAssignmentPanel=()=>'';
const isOwnTestTournament=()=>false,bracketRosterIsCurrent=()=>true,mapRegistrationError=e=>e.message||'讀取失敗';
const renderPreservingScroll=()=>render();
const userProfile={realName:'測試玩家',displayName:'測試玩家',role:'player',active:true},firebaseUser={uid:'fixture-user',email:'fixture@example.invalid'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FORMAT_LABELS={single:'單淘汰賽',double:'雙敗制',roundrobin:'單循環賽'};
const currentAuthUid=()=>firebaseUser.uid,cloudAvailable=()=>true,isCommunityRoomOwner=()=>state.ownerUid===firebaseUser.uid;
const touchCommunityActivity=()=>{},flushCloudStateWrites=async()=>true,syncEventInfoV2FromLegacy=()=>{};
const showToast=(message,error)=>fixture.toasts.push({message,error:!!error});
const saveRecord=async data=>{fixture.local=JSON.parse(JSON.stringify(data));return true};
const queueCloudSyncRetry=()=>{};
const enqueueCloudStateWrite=async(code,data)=>{fixture.saves++;if(fixture.fail)return false;fixture.cloud=JSON.parse(JSON.stringify(data));return true};
window.cloudSync={connect:async()=>{},joinRoom:async()=>fixture.cloud?{ok:true,data:JSON.parse(JSON.stringify(fixture.cloud))}:{ok:false},
 subscribeRegistrationsForAdmin:(code,next)=>{fixture.subscriptions=(fixture.subscriptions||0)+1;fixture.onRegistrationSnapshot=next;setTimeout(()=>next(fixture.rows||[]),0);return ()=>{fixture.unsubscribed=(fixture.unsubscribed||0)+1;};},
 syncCommunityRegistrationSummary:async()=>{fixture.catchups=(fixture.catchups||0)+1;if(fixture.failSync)throw Error('網路暫時無法連線');return {ok:true,communityParticipantCount:(fixture.cloud.players||[]).length};}};
window.engagementService={roomAccess:async()=>{fixture.accessCalls=(fixture.accessCalls||0)+1;return {ok:true}}};
const applyRemoteState=data=>{state=data;render()};
// Preserve production shell/layout classes while omitting decorative/auth services.
const authShellOpen=()=>'<div class="auth-shell"><div class="auth-scroll"><div class="auth-content">',authShellClose=()=>'</div></div></div>',authBrandHeader=()=>'',renderModal=()=>'';
const publicVenueFromTournament=()=>({}),renderVenueNavigationMenu=()=>'',isGuestReadOnlyContext=()=>false,renderTournamentStandardTemplate=()=>'',renderRegistrationCountdown=()=>'';
const TARGET_GROUP_LABELS={open:'公開組'},TARGET_GROUP_DESCRIPTIONS={open:'不限年齡，符合活動規則者皆可參加。'},REGISTRATION_STATUS_LABELS={open:'報名中',closed:'報名截止',started:'已開始',full:'已額滿'};
let tournamentDetailCode='LOCAL-ONLY',tournamentDetailData=null,tournamentDetailLoading=false,tournamentDetailError=null,tournamentDetailMyRegs=[],tournamentDetailMyReg=null,tournamentDetailBusy=false,tournamentDetailChildConfirmed=false;
const bindDynamicInputs=()=>{};
function renderCommunityRoomApp(){return fixture.screen==='settings'?'<main>'+window.BXHCommunityHostFeature.renderCommunitySettings()+'</main>':'<main>'+renderPeopleManagement()+'</main>'}
function render(){reconcileRegistrationRosterContext();const app=document.getElementById('app');if(fixture.screen==='settings'||fixture.screen==='people'){renderCommunityRoomPreservingSettings(app);return;}communitySettingsRenderedContext=null;app.innerHTML=renderTournamentDetailScreen()}
function showPeople(){fixture.screen='people';appPhase='community-room';communityRoomActiveTab='people';activeTab='live';peopleRosterSection='confirmed';render();}
function serverRegistersPlayer(){const row={registrationId:'server-reg',status:'confirmed',publicName:'新報名選手'};fixture.rows=[row];fixture.cloud.players=[{id:'server-player',name:'新報名選手',source:'online',registrationId:'server-reg',checkedIn:true}];fixture.cloud.registrationRosterRevision=1;fixture.cloud.updatedAt=Date.now();fixture.onRegistrationSnapshot(fixture.rows);}
function showDetail(rows=[]){const st=fixture.cloud||state,m=st.meta;tournamentDetailData={code:st.cloudCode,name:m.name,eventAuthority:'community',communityQuickRegistration:m.communityQuickRegistration,registrationEnabled:m.registrationEnabled,registrationStatus:m.registrationStatus,capacity:m.registrationCapacity,confirmedCount:0,registrationOpenAt:m.registrationOpenAt,registrationCloseAt:m.registrationCloseAt,cancellationDeadline:m.cancellationDeadline,waitlistEnabled:m.waitlistCapacity>0,waitlistCapacity:m.waitlistCapacity,waitlistCount:0,tournamentPhase:'waiting',targetGroup:'open',parsedData:st};tournamentDetailMyRegs=rows;fixture.screen='detail';appPhase='tournament-detail';render()}
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target)handleFixtureAction(target.dataset.action,target)});
`;
const styles=['core-competition','auth-player','player-center-hunter','lobby-community','call-admin-tail','referee-tail','tail-p7'].map(name=>read('modules/main-css/'+name+'.css')).join('\n');
(async()=>{
 const output=path.join(root,'test-results/community-quick-registration');fs.mkdirSync(output,{recursive:true});
 const checks=[];let browser;
 try{
  // CI's pinned Playwright image supplies the matching bundled Chromium.
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  for(const size of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
   const context=await browser.newContext({viewport:{width:size.width,height:size.height},serviceWorkers:'block'});
   await context.route('**/*',route=>route.abort('blockedbyclient'));
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   try{
   await page.setContent('<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style></head><body><div id="app"></div></body></html>');
   await page.addScriptTag({content:bootstrap});
   for(const file of ['domain-utils','registration-utils','input-utils','community-host'])await page.addScriptTag({content:read('modules/main-app/'+file+'.js')});
   await page.addScriptTag({content:'const {isCommunityQuickRegistration,isUnlimitedCommunityRegistration,parseCommunityRegistrationCapacity,communityRegistrationCapacity,communityRegistrationParticipantCount,communityLocalParticipantCount,communityRegistrationLocked,canCancelCommunityRegistration,publicTournamentRegistrationLocked,canonicalPublicTournamentPhase,roomStatusDescriptor}=window.BXHDomainUtils;const {normalizeDateTime,normalizeRegistrationStatusValue}=window.BXHRegistrationUtils;const {communityDateTimeValue,formatTournamentDetailDateTime,tournamentBattleMode,tournamentTeamSize}=window.BXHInputUtils;'+['communitySettingsDraftContext','communitySettingsInputs','communitySettingBadInput','setCommunitySettingsInputsSaving','captureCommunitySettingsInputs','restoreCommunitySettingsInputs','renderCommunityRoomPreservingSettings','cloneStateForSave','computeRegistrationStatus','saveState','getEffectiveRegistrationStatus','publicEventLifecycleStatus','renderTournamentDetailScreen'].map(fn).join('\n')+'\n'+rosterSource+'\n'+action+'\nrender();'});
   await page.locator('#cset-capacity').fill('');await page.locator('#cset-registration-enabled').check();
   // Settings fields survive background renders, including invalid native input.
   await page.locator('#cset-name').fill('尚未儲存的房間名稱');
   await page.locator('#cset-stations').fill('2');
   await page.locator('#cset-access-mode').selectOption('password');
   await page.locator('#cset-access-password').fill('local-review-pass');
   await page.locator('#cset-capacity').press('-');
   assert.equal(await page.locator('#cset-capacity').evaluate(input=>input.validity.badInput),true);
   await page.evaluate(()=>render());
   assert.equal(await page.locator('#cset-name').inputValue(),'尚未儲存的房間名稱');
   assert.equal(await page.locator('#cset-stations').inputValue(),'2');
   assert.equal(await page.locator('#cset-registration-enabled').isChecked(),true);
   assert.equal(await page.locator('#cset-access-password').inputValue(),'local-review-pass');
   assert.equal(await page.locator('#cset-capacity').evaluate(input=>input.dataset.communityDraftInvalid),'true');
   await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   assert.equal(await page.evaluate(()=>fixture.saves),0,'Invalid native input must not become an intentional unlimited capacity');
   await page.locator('#cset-capacity').fill('7');await page.locator('#cset-capacity').fill('');

   await page.screenshot({path:path.join(output,size.name+'-settings.png'),fullPage:true,animations:'disabled'});
   await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   await page.waitForFunction(()=>fixture.cloud?.meta.communityQuickRegistration===true&&!communitySettingsSaving);
   assert.equal(await page.evaluate(()=>fixture.cloud.meta.registrationCapacity),null);
   assert.equal(await page.evaluate(()=>fixture.cloud.meta.registrationStatus),'open');
   assert.equal(await page.evaluate(()=>fixture.cloud.meta.stations),2);
   assert.equal(await page.locator('#cset-access-password').inputValue(),'');
   assert.equal(await page.evaluate(()=>fixture.accessCalls),1);
   assert.equal(await page.evaluate(()=>JSON.stringify([fixture.cloud,fixture.local]).includes('local-review-pass')),false,'Password draft must never enter persistent room snapshots');
   assert.equal(await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).isEnabled(),true);
   await page.screenshot({path:path.join(output,size.name+'-saved.png'),fullPage:true,animations:'disabled'});
   // The just-rendered save button must be usable again, not left in its busy state.
   await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   await page.waitForFunction(()=>fixture.saves===2&&!communitySettingsSaving);
   assert.equal(await page.evaluate(()=>fixture.accessCalls),1,'Repeated settings save must not configure the cleared password again');
   await page.locator('#cset-capacity').fill('0');await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   assert.equal(await page.evaluate(()=>fixture.saves),2);
   assert.match(await page.evaluate(()=>fixture.toasts.at(-1).message),/大於 0/);
   await page.locator('#cset-capacity').fill('8');await page.evaluate(()=>fixture.fail=true);
   await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   await page.waitForFunction(()=>fixture.saves===3&&!communitySettingsSaving);
   assert.equal(await page.evaluate(()=>state.meta.registrationCapacity),null);
   assert.equal(await page.evaluate(()=>fixture.toasts.at(-1).error),true);
   assert.equal(await page.locator('#cset-capacity').inputValue(),'8','Rejected settings retain the editable draft');
   assert.equal(await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).isEnabled(),true);
   await page.screenshot({path:path.join(output,size.name+'-rejected-save.png'),fullPage:true,animations:'disabled'});
   // Restore the persisted in-memory snapshot rather than trusting the active UI.
   await page.evaluate(()=>{communityRoomSnapshotGeneration++;communitySettingsRenderedContext=null;state=JSON.parse(JSON.stringify(fixture.cloud));render()});
   assert.equal(await page.locator('#cset-capacity').inputValue(),'');
   assert.equal(await page.locator('#cset-registration-enabled').isChecked(),true);
   await page.evaluate(()=>showDetail());
   assert.equal(await page.locator('[data-participant-mode="self"]').isEnabled(),true);
   assert.equal(await page.locator('[data-participant-mode="children"]').isEnabled(),true);
   assert(await page.getByText('0 人已報名／不限人數',{exact:true}).count());
   assert.equal(await page.getByText(/Infinity|NaN/).count(),0);
   await page.screenshot({path:path.join(output,size.name+'-detail.png'),fullPage:true,animations:'disabled'});
   await page.locator('.tournament-registration-info').screenshot({path:path.join(output,size.name+'-registration-info.png')});
   await page.evaluate(()=>showDetail([{status:'confirmed',displayName:'測試玩家'}]));
   assert.equal(await page.locator('[data-participant-mode="self"]').count(),0);
   assert.equal(await page.locator('[data-participant-mode="children"]').isEnabled(),true);
   assert.equal(await page.locator('[data-action="cancel-my-registration"]').isEnabled(),true);
   const widths=await page.evaluate(()=>({body:document.body.scrollWidth,doc:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert(Math.max(widths.body,widths.doc)<=widths.viewport+4,JSON.stringify(widths));
   await page.screenshot({path:path.join(output,size.name+'-registered-actions.png'),fullPage:true,animations:'disabled'});
   // Ordinary player host: the production people renderer opens the watcher
   // using communityRoomActiveTab. Simulate only the trusted server commit.
   const savesBeforeRoster=await page.evaluate(()=>fixture.saves);
   await page.evaluate(()=>{fixture.failSync=true;showPeople()});
   await page.getByRole('alert').waitFor({state:'visible'});
   assert(await page.getByRole('alert').getByText(/線上名單尚未同步/).count());
   await page.evaluate(()=>{fixture.failSync=false;});
   await page.getByRole('button',{name:'重新同步名單',exact:true}).click();
   await page.waitForFunction(()=>!peopleRosterBusy&&!adminRegistrationsError);
   await page.evaluate(()=>serverRegistersPlayer());
   await page.getByRole('cell',{name:'新報名選手',exact:true}).waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>currentRole),'player');
   assert.equal(await page.evaluate(()=>activeTab),'live');
   assert.equal(await page.evaluate(()=>state.players[0].checkedIn),true);
   assert.equal(await page.evaluate(()=>fixture.saves),savesBeforeRoster,'roster refresh must not enqueue a client write');
   const caughtUp=await page.evaluate(()=>fixture.catchups);
   await page.evaluate(()=>fixture.onRegistrationSnapshot(fixture.rows));
   await page.evaluate(()=>adminRosterSyncChain);
   assert.equal(await page.evaluate(()=>fixture.catchups),caughtUp,'repeat snapshots must not loop owner writes');
   assert.equal(await page.getByRole('cell',{name:'新報名選手',exact:true}).count(),1);
   await page.screenshot({path:path.join(output,size.name+'-host-roster.png'),fullPage:true,animations:'disabled'});
   await page.evaluate(()=>showDetail());
   assert.equal(await page.evaluate(()=>fixture.unsubscribed),1);
   await page.evaluate(()=>fixture.onRegistrationSnapshot([{registrationId:'stale',status:'confirmed'}]));
   assert.equal(await page.evaluate(()=>adminRegistrationsCache),null);
   assert.deepEqual(errors,[]);checks.push(size.name+': draft rerender/native invalid/password disposal, save/repeat/invalid/failure/persisted readback, unlimited self+child buttons, cancellation, player-owner auto roster/readback, retry, duplicate snapshot, unsubscribe, viewport PASS');
   fs.writeFileSync(path.join(output,size.name+'-results.json'),JSON.stringify({status:'passed',checks:checks.at(-1),errors,toasts:await page.evaluate(()=>fixture.toasts)},null,2)+'\n');
   }catch(error){
    await page.screenshot({path:path.join(output,size.name+'-failure.png'),fullPage:true}).catch(()=>{});
    fs.writeFileSync(path.join(output,size.name+'-results.json'),JSON.stringify({status:'failed',error:String(error.stack||error),errors},null,2)+'\n');
    throw error;
   }finally{await context.close()}
  }
 }catch(error){
  fs.writeFileSync(path.join(output,'run-failure.txt'),String(error.stack||error)+'\n');
  throw error;
 }finally{if(browser)await browser.close()}
 console.log(checks.join('\n'));console.log('Screenshots and results: '+output);
})().catch(error=>{console.error(error);process.exitCode=1});
