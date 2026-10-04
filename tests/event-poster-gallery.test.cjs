'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const ui=require('../event-poster-ui.js');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const css=fs.readFileSync(path.join(root,'modules/main-css/lobby-community.css'),'utf8');
const uiSource=fs.readFileSync(path.join(root,'event-poster-ui.js'),'utf8');
test('admin inline roster filters by seat type and exposes names only',()=>{
  const confirmed=ui.filterAdminRosterRows([
    {status:'confirmed',publicName:'阿明',email:'private@example.com'},
    {status:'waitlist',publicName:'小花'},
    {status:'confirmed',displayName:'',participantName:'小林',phone:'0912345678'}
  ],'confirmed');
  assert.deepEqual(confirmed,[{name:'阿明'},{name:'小林'}]);
  assert.deepEqual(ui.filterAdminRosterRows([{status:'confirmed',publicName:'阿明'}],'waitlist'),[]);
  assert.match(uiSource,/listRegistrationsForAdmin\(code\)/);
  assert.match(uiSource,/!canManageInCurrentInterface\(\)\)return/);
  assert.match(uiSource,/aria-expanded/);
  assert.match(uiSource,/名單載入中/);
  assert.match(uiSource,/max-height:220px;overflow:auto/);
  assert.ok(uiSource.includes("grid-template-columns:2.8em minmax(0,1fr)"));
  assert.match(uiSource,/tournament-inline-roster-index/);
  assert.match(uiSource,/white-space:nowrap;font-variant-numeric:tabular-nums/);
  assert.ok(uiSource.includes("查看名單⌄"));
  assert.ok(uiSource.includes("收合名單⌃"));
  assert.ok(uiSource.includes("輕點查看"));
  assert.match(uiSource,/data-roster-kind=confirmed/);
  assert.match(uiSource,/data-roster-kind=waitlist/);
});
test('poster links accept only versioned BXH Storage poster objects',()=>{
  const url='https://firebasestorage.googleapis.com/v0/b/bxh-arena.firebasestorage.app/o/room-posters%2FBXH-ABC123%2F12345678-1234-1234-1234-123456789abc.jpg?alt=media&token=12345678-1234-1234-1234-123456789abc';
  assert.equal(ui.safePosterUrl(url),url);
  assert.equal(ui.safePosterUrl('javascript:alert(1)'),'');
  assert.equal(ui.safePosterUrl(url.replace('room-posters%2F','room-covers%2F')),'');
});
test('management poster preview uses only a full-resolution poster URL',()=>{
  const poster='https://firebasestorage.googleapis.com/v0/b/bxh-arena.firebasestorage.app/o/room-posters%2FBXH-ABC123%2F12345678-1234-1234-1234-123456789abc.jpg?alt=media&token=12345678-1234-1234-1234-123456789abc';
  assert.equal(ui.managementPosterUrl(poster),poster);
  assert.equal(ui.managementPosterUrl('https://firebasestorage.googleapis.com/v0/b/bxh-arena.firebasestorage.app/o/room-covers%2FBXH-ABC123%2F12345678-1234-1234-1234-123456789abc.jpg?alt=media&token=12345678-1234-1234-1234-123456789abc'),'');
  assert.match(uiSource,/grid-template-columns:minmax\(88px,30%\)/);
  assert.match(uiSource,/object-fit:contain/);
  assert.match(uiSource,/data-poster-stats-layout/);
  assert.match(uiSource,/trigger\.closest\("\.lobby-poster-figure, \.tournament-poster-stats-preview"\)/);
  assert.match(uiSource,/if\(!poster\)return false/);
  assert.match(uiSource,/preview\.parentElement!==layout\|\|stats\.parentElement!==layout/);
  assert.match(uiSource,/grid-template-rows:repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(uiSource,/min-height:204px;display:flex;align-items:center;justify-content:center/);
  assert.match(uiSource,/syncAdminPosterStatHeight\(image,stats,preview\)/);
  assert.match(uiSource,/heightSource\.getBoundingClientRect\(\)\.height/);
  
  assert.match(uiSource,/new root\.ResizeObserver/);
  assert.match(uiSource,/\.observe\(heightSource\)/);
});
test('admin tournament query exposes the original poster URL for preview',()=>{
  const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');
  assert.match(cloud,/posterUrl: typeof d\.posterUrl==="string" \? d\.posterUrl : ""/);
});
test('image upload accepts only JPEG/PNG files within the callable transport limit',()=>{
  assert.equal(ui.MAX_FILE_BYTES,6*1024*1024);
  assert.equal(ui.validatePosterFile({type:'image/jpeg',size:1024}).ok,true);
  assert.equal(ui.validatePosterFile({type:'image/heic',size:1024}).reason,'format');
  assert.equal(ui.validatePosterFile({type:'image/png',size:6*1024*1024+1}).reason,'size');
});
test('poster management controls appear only in management interface modes',()=>{
  for(const mode of ['admin','event_staff','partner_organizer'])assert.equal(ui.isManagementMode(mode,'admin'),true);
  for(const mode of ['player','guest','',null,undefined])assert.equal(ui.isManagementMode(mode,'admin'),false);
  assert.equal(ui.isManagementMode('admin','player'),false);
  assert.equal(ui.isManagementMode('event_staff','guest'),false);
  assert.match(uiSource,/if\(!canManageInCurrentInterface\(\)\)\{button\.hidden=true;return;\}/);
  assert.match(uiSource,/button\.hidden=!canManageInCurrentInterface\(\)\|\|!result\|\|result\.allowed!==true/);
  assert.match(uiSource,/if\(!canManageInCurrentInterface\(\)\)\{manageButton\.hidden=true;return;\}/);
  assert.match(uiSource,/querySelectorAll\("\.tournament-management-card"\)/);
  assert.match(uiSource,/actions\.insertBefore\(button,copy\|\|null\)/);
  assert.match(uiSource,/button\.closest\("\.lobby-compact-card, \.tournament-management-card"\)/);
});
test('expanded event detail order is intro, copy, photo, roster, then registration',()=>{
  const start=core.indexOf('function lobbyCard(t, kind, loggedIn, expanded=false){');
  const end=core.indexOf('\nfunction lobbyMatchesActiveFilters',start);
  const card=core.slice(start,end),summary=card.slice(0,card.indexOf('</summary>'));
  const head=card.indexOf('lobby-event-intro-head'),copy=card.indexOf('lobby-description'),photo=card.indexOf('data-poster-slot'),players=card.indexOf('lobbyPlayerRosterHtml(t)'),registration=card.indexOf('lobbyRegistrationButtons(t,loggedIn)');
  assert.ok(head>=0&&head<copy&&copy<photo&&photo<players&&players<registration);
  assert.doesNotMatch(summary,/data-poster-manage/);
  assert.ok(card.includes('放大＋'));
});
test('poster viewer uses contain sizing and an empty slot collapses',()=>{
  assert.ok(css.includes('object-fit:contain'));
  assert.ok(css.includes('.lobby-poster-slot:empty{display:none}'));
});
test('upload target remains fixed and viewer listeners are released on every close',()=>{
  assert.ok(uiSource.includes('const code=modal._code,card=modal._card;'));
  assert.ok(uiSource.includes('if(!manager||manager._saving)return;'));
  assert.ok(uiSource.includes('if(!viewer||viewer!==overlay)return;'));
  assert.ok(uiSource.includes('document.removeEventListener("keydown",keydown);'));
});
