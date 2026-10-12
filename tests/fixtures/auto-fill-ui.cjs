'use strict';
// Synthetic in-memory host for the production renderers and configure handler.
// Never loads Firebase or sends requests to the production app.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
function block(start,end){const a=core.indexOf(start),b=core.indexOf(end,a);assert.ok(a>=0&&b>a,start);return core.slice(a,b);}
const production=[
 block('function renderTeamAdminRegistrations(','async function copyRegistrationUrlDirect('),
 block('function canManageOnsiteWaitlist(){','let onsiteCheckinContext'),
 block('function peopleRosterMutationLocked(){','async function peopleReportRosterPermission('),
 block('async function peopleApplyCloudRosterResult(','async function peoplePromoteOnline('),
 block('let peopleAutoFillOperation=null;','async function peoplePromoteLocal('),
 block('function renderPeopleManagement(){','function renderBxhEventTemplateSettingsSection(')
].join('\n');
const dispatch=core.match(/if\(action==="people-toggle-auto-fill"\)\{[^\n]+\}/)?.[0];
assert.ok(dispatch,'canonical auto-fill dispatch exists');
const source=`
var state={id:'fixture-room',cloudCode:'BXH-FIXTURE',meta:{registrationEnabled:true,registrationCapacity:32,battleMode:'individual',ladderMode:'ranked'},players:[],waitlistPlayers:[],matches:[],registrationRosterRevision:0};
var firebaseUser={uid:'fixture-admin'},userProfile={role:'admin',active:true},activeTab='registrations',peopleRosterSection='waitlist';
var adminRegistrationsCache=[{registrationId:'first',uid:'first',status:'waitlist',displayName:'備取一',createdAt:100},{registrationId:'second',uid:'second',status:'waitlist',displayName:'備取二',createdAt:200}],adminRegistrationsLoading=false,adminRegistrationsError=null,adminRegistrationsBusy=false,peopleRosterBusy=false,adminRosterCode='BXH-FIXTURE';
var publicTournamentsCache={},myRegistrationsCache={},cloudStatus='',cloudLastSyncAt=0;
var fixture={calls:[],pending:[],toasts:[],renders:0,records:[],hold:false,fail:false,view:'registrations',html:''};
var currentAuthUid=()=>firebaseUser?.uid||'';
var esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
var normalizeDateTime=value=>Number(value)||0;
var canManageRegistrationRoster=()=>false,isCommunityQuickRegistration=()=>false;
var currentTournamentRegistrationLocked=()=>!!state.startedAt||state.archiveStatus==='completed'||state.meta.eventCancelled===true;
var renderStaffAssignmentPanel=()=>'',renderRefereeStationAssignmentPanel=()=>'',renderEntrySelection=()=>'',entryRosterValid=()=>true;
var BATTLE_MODE_LABELS={},FORMAT_LABELS={},tournamentStatus=()=>state.startedAt?'live':'waiting',participantDisplayName=p=>p.name||p.displayName||'';
var resetRegistrationFormDraft=()=>{},mapRegistrationError=e=>e.message||e.code||'更新失敗';
var saveRecord=async value=>{fixture.records.push(JSON.parse(JSON.stringify(value)));if(fixture.holdSave)await new Promise(resolve=>fixture.resolveSave=resolve);};
var showToast=(message,error=false)=>fixture.toasts.push({message,error});
window.cloudSync={configureAutoFill:async(code,enabled)=>{
 fixture.calls.push({code,enabled});
 if(fixture.fail)throw {code:'permission-denied'};
 const result={ok:true,enabled,state:JSON.parse(JSON.stringify(state))};result.state.meta.registrationAutoFillEnabled=enabled;result.state.registrationRosterRevision++;
 if(fixture.hold)return new Promise((resolve,reject)=>fixture.pending.push({resolve,reject,result}));
 return result;
}};
${production}
function handleAction(action,target){${dispatch}}
function render(){fixture.renders++;fixture.html=fixture.view==='people'?renderPeopleManagement():renderAdminRegistrationsTab();if(typeof document!=='undefined'){const app=document.getElementById('app');if(app)app.innerHTML=fixture.html;}}
fixture.resolve=(index=0)=>{const pending=fixture.pending[index];pending.resolve(pending.result);};
fixture.reject=(index=0)=>fixture.pending[index].reject({code:'network',message:'網路中斷，請重新整理確認'});
fixture.setView=view=>{fixture.view=view;activeTab=view;render();};
fixture.setRoom=()=>{state={...state,id:'other-room',cloudCode:'BXH-OTHER',meta:{...state.meta,registrationAutoFillEnabled:false}};render();};
`;
module.exports={root,core,block,source};
