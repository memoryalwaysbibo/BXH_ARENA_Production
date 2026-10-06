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
const action='function handleFixtureAction(action,target){'+core.slice(saveStart,saveEnd)+'}';
const state={id:'fixture-room',cloudCode:'LOCAL-ONLY',ownerUid:'fixture-user',players:[],matches:[],startedAt:null,archiveStatus:'ongoing',meta:{name:'一般玩家的房間',date:'2026-10-05',location:'玩家即時對戰',startTime:'10:00',formatType:'single',format:'單淘汰賽',stations:1,eventAuthority:'community',ladderMode:'general',registrationEnabled:false,registrationStatus:'closed',registrationCapacity:16,waitlistCapacity:2,roomAccessMode:'public'}};
const bootstrap=`
window.fixture={state:${JSON.stringify(state)},cloud:null,local:null,saves:0,fail:false,toasts:[],screen:'settings'};
let state=fixture.state,communitySettingsSaving=false,communitySettingsWriteGate=null,communityCreateSaving=false,cloudSyncPending=false,cloudSyncQueueTimer=null,cloudStatus='connected',cloudLastSyncAt=0,cloudAccessLimited=false,cloudAccessMessage='',currentRole='player';
let publicTournamentsCache=[],communityEventsCache=[];
const userProfile={realName:'測試玩家',displayName:'測試玩家'},firebaseUser={uid:'fixture-user',email:'fixture@example.invalid'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const FORMAT_LABELS={single:'單淘汰賽',double:'雙敗制',roundrobin:'單循環賽'};
const currentAuthUid=()=>firebaseUser.uid,cloudAvailable=()=>true,isCommunityRoomOwner=()=>state.ownerUid===firebaseUser.uid;
const touchCommunityActivity=()=>{},flushCloudStateWrites=async()=>true,syncEventInfoV2FromLegacy=()=>{};
const showToast=(message,error)=>fixture.toasts.push({message,error:!!error});
const saveRecord=async data=>{fixture.local=JSON.parse(JSON.stringify(data));return true};
const queueCloudSyncRetry=()=>{};
const enqueueCloudStateWrite=async(code,data)=>{fixture.saves++;if(fixture.fail)return false;fixture.cloud=JSON.parse(JSON.stringify(data));return true};
window.cloudSync={connect:async()=>{},joinRoom:async()=>fixture.cloud?{ok:true,data:JSON.parse(JSON.stringify(fixture.cloud))}:{ok:false}};
window.engagementService={roomAccess:async()=>({ok:true})};
const applyRemoteState=data=>{state=data;render()};
// Preserve production shell/layout classes while omitting decorative/auth services.
const authShellOpen=()=>'<div class="auth-shell"><div class="auth-scroll"><div class="auth-content">',authShellClose=()=>'</div></div></div>',authBrandHeader=()=>'',renderModal=()=>'';
const publicVenueFromTournament=()=>({}),renderVenueNavigationMenu=()=>'',isGuestReadOnlyContext=()=>false,renderTournamentStandardTemplate=()=>'',renderRegistrationCountdown=()=>'';
const TARGET_GROUP_LABELS={open:'公開組'},TARGET_GROUP_DESCRIPTIONS={open:'不限年齡，符合活動規則者皆可參加。'},REGISTRATION_STATUS_LABELS={open:'報名中',closed:'報名截止',started:'已開始',full:'已額滿'};
let tournamentDetailCode='LOCAL-ONLY',tournamentDetailData=null,tournamentDetailLoading=false,tournamentDetailError=null,tournamentDetailMyRegs=[],tournamentDetailMyReg=null,tournamentDetailBusy=false,tournamentDetailChildConfirmed=false;
function render(){document.getElementById('app').innerHTML=fixture.screen==='settings'?'<main>'+window.BXHCommunityHostFeature.renderCommunitySettings()+'</main>':renderTournamentDetailScreen()}
function showDetail(rows=[]){const st=fixture.cloud||state,m=st.meta;tournamentDetailData={code:st.cloudCode,name:m.name,eventAuthority:'community',communityQuickRegistration:m.communityQuickRegistration,registrationEnabled:m.registrationEnabled,registrationStatus:m.registrationStatus,capacity:m.registrationCapacity,confirmedCount:0,registrationOpenAt:m.registrationOpenAt,registrationCloseAt:m.registrationCloseAt,cancellationDeadline:m.cancellationDeadline,waitlistEnabled:m.waitlistCapacity>0,waitlistCapacity:m.waitlistCapacity,waitlistCount:0,tournamentPhase:'waiting',targetGroup:'open',parsedData:st};tournamentDetailMyRegs=rows;fixture.screen='detail';render()}
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
   await page.addScriptTag({content:'const {isCommunityQuickRegistration,isUnlimitedCommunityRegistration,parseCommunityRegistrationCapacity,communityRegistrationCapacity,communityRegistrationParticipantCount,communityLocalParticipantCount,communityRegistrationLocked,canCancelCommunityRegistration,publicTournamentRegistrationLocked,canonicalPublicTournamentPhase,roomStatusDescriptor}=window.BXHDomainUtils;const {normalizeDateTime,normalizeRegistrationStatusValue}=window.BXHRegistrationUtils;const {communityDateTimeValue,formatTournamentDetailDateTime,tournamentBattleMode,tournamentTeamSize}=window.BXHInputUtils;'+['cloneStateForSave','computeRegistrationStatus','saveState','getEffectiveRegistrationStatus','publicEventLifecycleStatus','renderTournamentDetailScreen'].map(fn).join('\n')+'\n'+action+'\nrender();'});
   await page.locator('#cset-capacity').fill('');await page.locator('#cset-registration-enabled').check();
   await page.screenshot({path:path.join(output,size.name+'-settings.png'),fullPage:true});
   await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   await page.waitForFunction(()=>fixture.cloud?.meta.communityQuickRegistration===true&&!communitySettingsSaving);
   assert.equal(await page.evaluate(()=>fixture.cloud.meta.registrationCapacity),null);
   assert.equal(await page.evaluate(()=>fixture.cloud.meta.registrationStatus),'open');
   assert.equal(await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).isEnabled(),true);
   await page.screenshot({path:path.join(output,size.name+'-saved.png'),fullPage:true});
   // The just-rendered save button must be usable again, not left in its busy state.
   await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   await page.waitForFunction(()=>fixture.saves===2&&!communitySettingsSaving);
   await page.locator('#cset-capacity').fill('0');await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   assert.equal(await page.evaluate(()=>fixture.saves),2);
   assert.match(await page.evaluate(()=>fixture.toasts.at(-1).message),/大於 0/);
   await page.locator('#cset-capacity').fill('8');await page.evaluate(()=>fixture.fail=true);
   await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).click();
   await page.waitForFunction(()=>fixture.saves===3&&!communitySettingsSaving);
   assert.equal(await page.evaluate(()=>state.meta.registrationCapacity),null);
   assert.equal(await page.evaluate(()=>fixture.toasts.at(-1).error),true);
   assert.equal(await page.getByRole('button',{name:'儲存一般賽事設定',exact:true}).isEnabled(),true);
   await page.screenshot({path:path.join(output,size.name+'-rejected-save.png'),fullPage:true});
   // Restore the persisted in-memory snapshot rather than trusting the active UI.
   await page.evaluate(()=>{state=JSON.parse(JSON.stringify(fixture.cloud));render()});
   assert.equal(await page.locator('#cset-capacity').inputValue(),'');
   assert.equal(await page.locator('#cset-registration-enabled').isChecked(),true);
   await page.evaluate(()=>showDetail());
   assert.equal(await page.locator('[data-participant-mode="self"]').isEnabled(),true);
   assert.equal(await page.locator('[data-participant-mode="children"]').isEnabled(),true);
   assert(await page.getByText('0 人已報名／不限人數',{exact:true}).count());
   assert.equal(await page.getByText(/Infinity|NaN/).count(),0);
   await page.screenshot({path:path.join(output,size.name+'-detail.png'),fullPage:true});
   await page.locator('.tournament-registration-info').screenshot({path:path.join(output,size.name+'-registration-info.png')});
   await page.evaluate(()=>showDetail([{status:'confirmed',displayName:'測試玩家'}]));
   assert.equal(await page.locator('[data-participant-mode="self"]').count(),0);
   assert.equal(await page.locator('[data-participant-mode="children"]').isEnabled(),true);
   assert.equal(await page.locator('[data-action="cancel-my-registration"]').isEnabled(),true);
   const widths=await page.evaluate(()=>({body:document.body.scrollWidth,doc:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert(Math.max(widths.body,widths.doc)<=widths.viewport+4,JSON.stringify(widths));
   await page.screenshot({path:path.join(output,size.name+'-registered-actions.png'),fullPage:true});
   assert.deepEqual(errors,[]);checks.push(size.name+': save/repeat/invalid/failure/persisted readback, unlimited self+child buttons, cancellation availability, viewport PASS');
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
