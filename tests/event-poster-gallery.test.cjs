'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {test}=require('node:test');
const ui=require('../event-poster-ui.js');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const css=fs.readFileSync(path.join(root,'modules/main-css/lobby-community.css'),'utf8');
test('poster links accept only versioned BXH Storage poster objects',()=>{
  const url='https://firebasestorage.googleapis.com/v0/b/bxh-arena.firebasestorage.app/o/room-posters%2FBXH-ABC123%2F12345678-1234-1234-1234-123456789abc.jpg?alt=media&token=12345678-1234-1234-1234-123456789abc';
  assert.equal(ui.safePosterUrl(url),url);
  assert.equal(ui.safePosterUrl('javascript:alert(1)'),'');
  assert.equal(ui.safePosterUrl(url.replace('room-posters%2F','room-covers%2F')),'');
});
test('image upload accepts only JPEG/PNG files within the callable transport limit',()=>{
  assert.equal(ui.MAX_FILE_BYTES,6*1024*1024);
  assert.equal(ui.validatePosterFile({type:'image/jpeg',size:1024}).ok,true);
  assert.equal(ui.validatePosterFile({type:'image/heic',size:1024}).reason,'format');
  assert.equal(ui.validatePosterFile({type:'image/png',size:6*1024*1024+1}).reason,'size');
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
