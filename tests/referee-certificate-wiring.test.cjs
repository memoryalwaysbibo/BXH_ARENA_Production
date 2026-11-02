'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
test('presentation rank requirements and milestone definitions match the authoritative service',()=>{
  const c=vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync('modules/referee-license/domain.js','utf8'),c);
  const server=require('../referee-certificates/functions/domain.cjs');
  assert.deepEqual(JSON.parse(JSON.stringify(c.window.BXHRefereeLicenseDomain.RANKS)),server.RANKS);
  assert.deepEqual(JSON.parse(JSON.stringify(c.window.BXHRefereeLicenseDomain.MILESTONES)),server.MILESTONES);
});
function extract(name){
  const start=core.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing real application function '+name);
  const end=core.indexOf('\n}',start)+2;
  assert.ok(end>start);
  return core.slice(start,end);
}
function context(){
  const calls=[];
  const c=vm.createContext({window:{BXH_REFEREE_CERTIFICATES_V1:true},calls,
    firebaseUser:{uid:'referee'},userProfile:{active:true,role:'player',realName:'本人'},
    engagementSessionEpoch:4,renderPreservingScroll:()=>calls.push('render'),
    appPhase:'player-center',playerActiveTab:'profile',playerStatsSubTab:'overview',playerProfileSectionUid:'referee',
    playerProfileSection:'duty',playerCenterPeriod:'season',playerCenterCareerVisibleCount:10,
    playerCenterHistoryVisibleCount:10,hunterProfileCache:{},myLadderProfileCache:{},
    renderPlayerCenterOverview:()=>'<p>overview</p>',setTimeout:()=>0});
  c.window.BXHRefereeLicense={
    renderDuty:ctx=>{calls.push({view:'duty',uid:ctx.uid,admin:ctx.isSuperAdmin});return '<p>certificate</p>';},
    renderAchievements:ctx=>{calls.push({view:'achievements',uid:ctx.uid});return '<p>achievements</p>';},
    renderAdmin:ctx=>{calls.push({view:'admin',uid:ctx.uid});return '<p>admin</p>';},
    resetSession:()=>calls.push('reset'),handleAction:(action,target,ctx)=>calls.push({action,uid:ctx.uid})
  };
  for(const name of ['canManageRefereeCertificates','refereeLicenseContext','renderRefereeLicensePage','renderPlayerProfileTab'])vm.runInContext(extract(name),c);
  c.currentAuthUid=()=>c.firebaseUser?.uid||null;
  return c;
}
test('an ordinary player can open their own duty certificate and referee achievements',()=>{
  const c=context();
  let html=c.renderPlayerProfileTab(c.userProfile);
  assert.match(html,/我的執勤/);assert.match(html,/我的成就/);assert.match(html,/certificate/);
  assert.equal(c.calls[0].uid,'referee');assert.equal(c.calls[0].admin,false);
  c.playerProfileSection='achievements';html=c.renderPlayerProfileTab(c.userProfile);
  assert.match(html,/<p>achievements/);assert.equal(c.calls.at(-1).view,'achievements');
});
test('closed rollout falls back to overview without issuing a certificate request',()=>{
  const c=context();c.window.BXH_REFEREE_CERTIFICATES_V1=false;
  const html=c.renderPlayerProfileTab(c.userProfile);
  assert.equal(c.playerProfileSection,'overview');assert.match(html,/overview/);
  assert.doesNotMatch(html,/data-section="(?:duty|achievements)"/);assert.equal(c.calls.length,0);
  const index=fs.readFileSync('index.html','utf8');
  assert.match(index,/window\.BXH_REFEREE_CERTIFICATES_V1\s*=\s*false/);
  assert.ok(index.indexOf('modules/referee-license/domain.js')<index.indexOf('modules/referee-license/ui.js'));
  assert.ok(index.indexOf('modules/referee-license/ui.js')<index.indexOf('id="bxh-main-app-m7"'));
});
test('only active, non-test super administrators get the management UI',()=>{
  const c=context();
  for(const patch of [{role:'player'},{role:'admin'},{role:'staff'},{role:'super_admin',active:false},{role:'super_admin',active:undefined},{role:'super_admin',isTestAccount:true},{role:'super_admin',deleted:true},{role:'super_admin',accountStatus:'frozen'}]){
    c.userProfile={active:true,...patch};assert.equal(c.canManageRefereeCertificates(),false);
    assert.match(c.renderRefereeLicensePage('admin'),/無法管理/);
  }
  assert.equal(c.calls.length,0);
  c.userProfile={active:true,role:'super_admin'};assert.equal(c.canManageRefereeCertificates(),true);
  assert.match(c.renderRefereeLicensePage('admin'),/<p>admin/);
  c.firebaseUser=null;assert.equal(c.canManageRefereeCertificates(),false);
});
test('async context reads the current identity and cannot retain authority after account change',()=>{
  const c=context();c.userProfile={active:true,role:'super_admin'};
  const ctx=c.refereeLicenseContext();assert.equal(ctx.isSuperAdmin,true);assert.equal(ctx.epoch,4);
  c.firebaseUser={uid:'another'};c.engagementSessionEpoch=5;c.userProfile={active:true,role:'player'};
  assert.equal(ctx.currentSession().uid,'another');assert.equal(ctx.currentSession().epoch,5);
  assert.equal(ctx.currentSession().isSuperAdmin,false);
  assert.equal(ctx.onRefereeAchievements(),true);assert.equal(c.playerProfileSection,'achievements');
  c.appPhase='app';assert.equal(ctx.onRefereeAchievements(),false);
  ctx.onHunterAchievements();assert.equal(c.playerActiveTab,'stats');assert.equal(c.playerStatsSubTab,'achievements');
});
test('logout and UID changes reset certificate cache alongside the shared session epoch',()=>{
  const c=context();Object.assign(c,{engagementSessionKey:'referee',engagementRequestGeneration:0,engagementDayTimer:null,clearTimeout:()=>{}});
  vm.runInContext(extract('syncEngagementIdentity'),c);
  c.syncEngagementIdentity('referee');assert.equal(c.calls.length,0);
  c.syncEngagementIdentity('');assert.equal(c.engagementSessionEpoch,5);assert.deepEqual(c.calls,['reset']);
  c.syncEngagementIdentity('other');assert.equal(c.engagementSessionEpoch,6);assert.deepEqual(c.calls,['reset','reset']);
});
test('session restoration keeps enabled player routes and rejects disabled or unauthorized management routes',()=>{
  const c=context();Object.assign(c,{authViewRestoreAttempted:false,AUTH_VIEW_KEY:'fixture',getTournamentEntryFromUrl:()=>null,
    pendingRegistrationCode:null,guestReadOnlyMode:false,isSuperAdmin:()=>c.canManageRefereeCertificates(),
    playerVisibleTabs:()=>[],state:{cloudCode:'ROOM'},adminTournamentListLoaded:true});
  let saved;
  c.sessionStorage={getItem:()=>JSON.stringify(saved)};
  vm.runInContext(extract('restoreAuthenticatedView'),c);
  function restore(value,intent){saved={uid:'referee',cloudCode:'ROOM',mode:intent,...value};c.authViewRestoreAttempted=false;return c.restoreAuthenticatedView('referee',intent);}
  assert.equal(restore({phase:'player-center',playerTab:'profile',profileSection:'achievements'},'player'),true);
  assert.equal(c.playerProfileSection,'achievements');
  c.window.BXH_REFEREE_CERTIFICATES_V1=false;
  restore({phase:'player-center',playerTab:'profile',profileSection:'duty'},'player');assert.equal(c.playerProfileSection,'overview');
  c.userProfile={active:true,role:'super_admin'};
  restore({phase:'app',tab:'referee-admin'},'admin');assert.equal(c.activeTab,'management');
  c.window.BXH_REFEREE_CERTIFICATES_V1=true;
  restore({phase:'app',tab:'referee-admin'},'admin');assert.equal(c.activeTab,'referee-admin');
  c.userProfile={active:true,role:'admin'};
  restore({phase:'app',tab:'referee-admin'},'admin');assert.equal(c.activeTab,'management');
});
test('management V2 only exposes referee management when core gives it the allowed tab',()=>{
  const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('modules/management-v2/navigation.js','utf8'),c);
  const nav=c.window.BXH_MANAGEMENT_UI_V2;
  assert.doesNotMatch(nav.renderRails('live',['live','referee']),/裁判管理/);
  assert.match(nav.renderRails('referee-admin',['live','referee-admin']),/裁判管理/);
  assert.equal(nav.groupForTab('referee-admin').id,'referee');
});
test('certificate calls use the existing authenticated callable bridge and timeout',async()=>{
  const source=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8');
  const method=source.match(/async refereeLicense\(payload\)\{[^\n]+\}/)?.[0];assert.ok(method);
  const calls=[];const c=vm.createContext({callEngagementFunction:(...args)=>{calls.push(args);return Promise.resolve({ok:true});}});
  const api=vm.runInContext('({'+method.replace(/,$/,'')+'})',c);
  const payload={action:'get'};assert.equal((await api.refereeLicense(payload)).ok,true);
  assert.deepEqual(calls,[['refereeCertificateService',payload,60000]]);
});
