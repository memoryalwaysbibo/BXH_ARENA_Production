'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
function take(name){const start=src.indexOf('function '+name+'(');assert.ok(start>=0,name);const eol=src.indexOf('\n',start);return src.slice(start,src.slice(start,eol).endsWith('}')?eol:src.indexOf('\n}',eol)+2);}
function scope(room){
 const ctx={state:room,userProfile:{active:true,role:'staff'},firebaseUser:{uid:'staff'},currentRole:'admin',currentAuthUid:()=> 'staff',isAdminTierOrAbove:()=>false,isOwnTestTournament:()=>false,isCommunityRoomOwner:()=>false,isPartnerOrganizerMode:()=>false,isEventStaffMode:()=>false,isStaffTier:()=>true,isCurrentOfficialTournamentCreator:()=>false,isTester:()=>false,hasAdminAccess:()=>true,PARTNER_REFEREE_SEATS_ROLLOUT:true,isPartnerRefereeSeatRoom:s=>s.createdByRole==='partner_organizer',partnerOrganizerGrant:()=>null,refereeStationRestrictionEnabled:()=>true};
 vm.createContext(ctx);for(const name of ['bxhOfficialStaffManager','isBXHOfficialStaffManager','canConfigureCurrentTournament','canManageRefereeSeats','canManageRefereeStationAssignments','canOperateStation','staffRosterReadOnly','canManageRegistrationRoster','canManageOnsiteWaitlist'])vm.runInContext(take(name),ctx);
 return ctx;
}
const room={createdBy:'other',meta:{eventAuthority:'official',assignedStaffUids:['other'],refereeSeatsV1:{version:1}},forcedCourtExits:{}};
test('unassigned staff can configure, read full roster, manage check-in and all courts in official room',()=>{
 const c=scope(room);for(const name of ['canConfigureCurrentTournament','canManageRefereeSeats','canManageRefereeStationAssignments','canManageRegistrationRoster','canManageOnsiteWaitlist'])assert.equal(c[name](),true,name);
 assert.equal(c.canOperateStation(1),true);assert.equal(c.staffRosterReadOnly(),false);
});
test('new owner grant excludes partner, community, sandbox and inactive/test accounts',()=>{
 const c=scope(room);
 for(const r of [{...room,createdByRole:'partner_organizer'},{...room,partnerOrganizationCode:'other'},{...room,meta:{eventAuthority:'community'}},{...room,testMode:true}])assert.equal(c.isBXHOfficialStaffManager(r),false);
 for(const u of [{active:false,role:'staff'},{active:true,role:'player'},{active:true,role:'staff',isTestAccount:true},{active:true,role:'staff',accountStatus:'frozen'}]){c.userProfile=u;assert.equal(c.isBXHOfficialStaffManager(),false);}
});
test('retired courts remain closed to staff managers',()=>{const c=scope({...room,forcedCourtExits:{1:{closed:true}}});assert.equal(c.canOperateStation(1),false);});
test('registration error is rendered before null-cache loading state',()=>{const body=take('renderAdminRegistrationsTab');assert.ok(body.indexOf('if(adminRegistrationsError)')<body.indexOf('if(adminRegistrationsCache===null)'));});
