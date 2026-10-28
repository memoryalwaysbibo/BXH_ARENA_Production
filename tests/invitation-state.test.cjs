'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
function block(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert.ok(a>=0&&b>a);return src.slice(a,b);}
function people(rows,error=null,online=true){
 const s={state:{id:'qa',cloudCode:'BXH-QA',players:[],waitlistPlayers:[],meta:{registrationEnabled:online,registrationCapacity:2}},adminRegistrationsCache:rows,adminRegistrationsError:error,adminRegistrationsLoading:false,adminRosterCode:'BXH-QA',peopleRosterSection:'waitlist',peopleRosterBusy:false,firebaseUser:{uid:'qa'},window:{},BATTLE_MODE_LABELS:{},FORMAT_LABELS:{},esc:String,setTimeout(){},startAdminRosterWatch(){},participantDisplayName:p=>p.name,peopleRegistrationIdOf:r=>r.id,peopleWaitlistShadow:()=>null};
 for(const k of ['peopleRosterMutationLocked','peopleRegistrationSelectionManaged','isCommunityQuickRegistration','peopleOnsiteWaitlistAvailable','peopleOnsiteWaitlistManaged','bracketCommitBlocked'])s[k]=()=>false;
 for(const k of ['canManageRegistrationRoster','entryRosterValid'])s[k]=()=>true;
 for(const k of ['renderStaffAssignmentPanel','renderRefereeStationAssignmentPanel','bracketCommitStatusHtml','bracketDrawButtonHtml','renderEntrySelection'])s[k]=()=>'';
 s.peopleLocalWaitlist=()=>s.state.waitlistPlayers;s.peopleOnlineWaitlistRows=()=>Array.isArray(s.adminRegistrationsCache)?s.adminRegistrationsCache.filter(r=>r.status==='waitlist'):[];
 vm.createContext(s);vm.runInContext(block(core,'function renderPeopleManagement(){','function renderBxhEventTemplateSettingsSection('),s);return s;
}
test('initial registration read never advertises an empty waitlist',()=>{
 const s=people(null),html=s.renderPeopleManagement();assert.match(html,/<strong>備取<\/strong><span>讀取中<\/span>/);assert.doesNotMatch(html,/目前沒有備取選手/);
 s.adminRegistrationsCache=[{id:'r',status:'waitlist',displayName:'Invited QA'}];const loaded=s.renderPeopleManagement();assert.match(loaded,/<strong>備取<\/strong><span>1 人<\/span>/);assert.match(loaded,/Invited QA/);assert.doesNotMatch(loaded,/讀取中/);
});
test('failed initial read reports unresolved rather than zero',()=>{const html=people(null,'network').renderPeopleManagement();assert.match(html,/<strong>備取<\/strong><span>尚未同步<\/span>/);assert.match(html,/線上名單尚未同步/);assert.doesNotMatch(html,/目前沒有備取選手/);});
test('loaded empty queue and local-only room can report zero',()=>{for(const s of [people([]),people(null,null,false)]){const html=s.renderPeopleManagement();assert.match(html,/<strong>備取<\/strong><span>0 人<\/span>/);assert.match(html,/目前沒有備取選手/);}});
test('registration source distinguishes accepted invitations from self signups',()=>{const s={};vm.createContext(s);vm.runInContext(block(core,'function registrationSourceLabel(','function renderPeopleManagement('),s);assert.equal(s.registrationSourceLabel({source:'host_invitation'}),'主辦邀請');assert.equal(s.registrationSourceLabel({source:'admin'}),'管理員新增');assert.equal(s.registrationSourceLabel({source:'player'}),'玩家自行報名');});
test('participation mail leaves status to the canonical invitation panel',()=>{
 const src=fs.readFileSync(path.join(root,'modules/main-app/mailbox.js'),'utf8'),s={esc:String,mailboxDate:()=>'',mailboxVisibleAttachments:()=>[],window:{}};vm.createContext(s);vm.runInContext(block(src,'function renderMailboxDetail(','// Keep .panel'),s);
 const render=extra=>s.renderMailboxDetail({id:'m',eventCode:'BXH-QA',...extra},{busy:false});
 for(const status of ['pending','waitlist','confirmed'])assert.doesNotMatch(render({type:'tournament_invitation',invitationStatus:status}),/邀請狀態：/);
 assert.match(render({type:'event_staff',invitationStatus:'accepted'}),/邀請狀態：已接受/);assert.match(render({type:'event_staff',invitationStatus:'invited'}),/接受工作人員（活動）邀請/);
});
