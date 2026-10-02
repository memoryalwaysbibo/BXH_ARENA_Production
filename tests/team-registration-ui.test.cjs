'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.argv[2]||path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')+'\n'+fs.readFileSync(path.join(root,'modules','main-app','core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'modules','cloud','cloud-runtime.js'),'utf8');
const family=fs.readFileSync(path.join(root,'family-ui.js'),'utf8');
let count=0;
const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};

test('team registration is one team-level callable',()=>{
  assert(html.includes('async teamRegistration(payload){return callEngagementFunction("teamRegistration"'));
  assert(html.includes('data-action="submit-team-registration"'));
  assert(html.includes('data-action="cancel-team-registration"'));
});

test('team form requires fixed N players and team name',()=>{
  assert(html.includes('id="team-registration-name"'));
  assert(html.includes('class="team-registration-member"'));
  assert(html.includes('if(memberEls.length!==size||members.some(name=>!name))'));
  assert(html.includes('本場每隊必須剛好 '+ "'+size+'" + ' 人'));
});

test('captain submits team as a whole',()=>{
  assert(html.includes('目前登入帳號會成為本隊「隊長」'));
  assert(html.includes('取消整隊報名'));
  assert(html.includes('會釋出 1 個隊伍名額'));
});

test('admin registration view groups by team and expands members',()=>{
  assert(html.includes('function renderTeamAdminRegistrations('));
  assert(html.includes("section('正取隊伍'"));
  assert(html.includes("section('備取隊伍'"));
  assert(html.includes('展開隊員'));
});

test('team roster projection expands fixed member slots',()=>{
  assert(family.includes('function mergeTeamOnlineRoster('));
  assert(family.includes('function teamRegistrationRowsToTeams('));
  assert(family.includes('teamMemberSlot:slot'));
});

test('team mode never falls through to individual bracket generator',()=>{
  assert(html.includes('if(state.meta&&state.meta.battleMode==="team") return generateTeamBracket();'));
  assert(html.includes('function generateTeamBracket(){'));
  assert(html.includes('teamIds:[a,b]'));
});

test('team capacities use team units',()=>{
  assert(html.includes('teamRegistrationMode?"正取隊伍上限":"正取人數上限"'));
  assert(html.includes('teamRegistrationMode?"備取隊伍上限（選填）":"備取人數上限（選填）"'));
  assert(html.includes('sm.battleMode==="team"?" 隊":" 人"'));
});

test('team lineup remains a later per-match step',()=>{
  assert(html.includes('出場順序不是現在提交'));
  assert(html.includes('直到裁判按下「人員到齊」才公開'));
});

test('team smart call does not use individual match assumptions',()=>{
  assert(html.includes('團體戰上場提醒將於團體裁判台完成後啟用'));
});

console.log('PASS '+count+' team registration UI regression cases.');
