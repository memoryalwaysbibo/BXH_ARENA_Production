'use strict';
// Isolated DOM verification of production renderers/actions; no Firebase or room writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const community=fs.readFileSync(path.join(root,'modules/main-app/community-host.js'),'utf8');
function fn(source,name){const match=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert(match,name);return source.slice(match.index,source.indexOf('\n}',match.index)+2);}
function action(name){const start=core.indexOf('  if(action==="'+name+'")');assert(start>=0,name);const end=core.indexOf('\n  if(action===',start+5);assert(end>start);return core.slice(start,end);}
const script=`
let state={id:'isolated',cloudCode:'TEST',onsiteWaitlistServerOwned:true,bracketSize:0,matches:[],meta:{name:'Test',registrationEnabled:true,registrationCapacity:32,waitlistCapacity:8}};
let registrationFormDraft={...state.meta},registrationFormDraftDirty=false,settingsFormDraft=null;
let appPhase='settings',activeTab='settings',communityRoomActiveTab='settings',peopleRosterSection='confirmed',communitySettingsSaving=false,aiCreateLastApplied=false;
let toastCount=0;
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const ensureRegistrationFormDraft=()=>{},canManageOnsiteWaitlist=()=>true,getEffectiveRegistrationStatus=()=>null,REGISTRATION_STATUS_LABELS={};
const renderHalfHourDatetimeDraft=id=>'<input id="'+id+'" type="datetime-local">';
const communityDateTimeValue=()=>'',showToast=()=>toastCount++,render=()=>{},syncSettingsDraftFromDom=()=>{};
${['onsiteRegistrationSettingsLocked','managedRegistrationSettingsNotice','reportManagedRegistrationSettings','renderRegistrationSettingsPanel'].map(n=>fn(core,n)).join('\n')}
${fn(community,'renderCommunitySettings')}
function handle(action,target){${action('open-registration-waitlist')} ${action('set-registration-enabled')}}
document.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(target)handle(target.dataset.action,target);});
window.fixture={render(kind,locked=true,finalized=false){state.onsiteWaitlistServerOwned=locked;state.onsiteWaitlistFinalized=finalized;document.body.innerHTML=kind==='community'?renderCommunitySettings():renderRegistrationSettingsPanel();},read(){return {activeTab,communityRoomActiveTab,peopleRosterSection,toastCount,enabled:registrationFormDraft.registrationEnabled};},phase(value){appPhase=value;},staleToggle(){handle('set-registration-enabled',{getAttribute:()=> 'false'});}};
`;
(async()=>{
 const options={headless:true};
 if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)options.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
 if(process.env.BXH_BROWSER_SINGLE_PROCESS==='1')options.args=['--single-process','--no-zygote'];
 const browser=await chromium.launch(options);
 try{
  const page=await browser.newPage();
  for(const width of [390,960]){
   await page.setViewportSize({width,height:844});
   await page.route('**/*',route=>route.abort());
   await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
   await page.addScriptTag({content:script});
   for(const kind of ['official','community']){
    await page.evaluate(kind=>window.fixture.render(kind),kind);
    const protectedIds=kind==='official'?['reg-open-at','reg-close-at','reg-capacity','reg-waitlist-capacity']:['cset-registration-enabled','cset-capacity','cset-waitlist','cset-reg-open','cset-reg-close','cset-reg-cancel'];
    for(const id of protectedIds)assert(await page.locator('#'+id).isDisabled(),`${width} ${kind} ${id} must be disabled`);
    for(const id of kind==='official'?['reg-fee','reg-event-desc']:['cset-name','cset-date','cset-location'])assert(await page.locator('#'+id).isEnabled(),id+' remains editable');
    assert.equal(await page.getByRole('status').count(),1);
    const saveAction=kind==='official'?'save-registration-settings':'community-save-settings';
    assert(await page.locator('[data-action="'+saveAction+'"]').isDisabled(),'active draw cannot save settings');
    assert(await page.getByRole('status').innerText().then(x=>x.includes('房間設定暫停儲存與發布')));
    assert.equal(await page.locator('#reg-capacity').count()===1?await page.locator('#reg-capacity').getAttribute('aria-describedby'):await page.locator('#cset-capacity').locator('xpath=ancestor::fieldset').getAttribute('aria-describedby'),'onsite-registration-lock-notice');
    await page.evaluate(kind=>window.fixture.render(kind,true,true),kind);
    for(const id of protectedIds)assert(await page.locator('#'+id).isDisabled(),id+' remains protected after finalize');
    assert(await page.locator('[data-action="'+saveAction+'"]').isEnabled(),'finalized draw permits metadata saves');
    assert(!(await page.getByRole('status').innerText()).includes('房間設定暫停儲存與發布'));

    await page.evaluate(kind=>window.fixture.phase(kind==='community'?'community-room':'settings'),kind);
    await page.locator('[data-action="open-registration-waitlist"]').click();
    const result=await page.evaluate(()=>window.fixture.read());
    assert.equal(kind==='community'?result.communityRoomActiveTab:result.activeTab,'people');assert.equal(result.peopleRosterSection,'waitlist');
    await page.evaluate(()=>window.fixture.staleToggle());
    assert.equal((await page.evaluate(()=>window.fixture.read())).enabled,true,'stale action cannot change mode');
    await page.evaluate(kind=>window.fixture.render(kind,false),kind);
    for(const id of protectedIds)assert(await page.locator('#'+id).isEnabled(),`${kind} ${id} unlocked`);
    assert.equal(await page.getByRole('status').count(),0);
   }
   console.log(`PASS managed settings DOM and routing at ${width}px`);
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
