'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const ui=require('./team-ui.js');
test('lobby escapes names and IDs and maintains disabled state',()=>{
 const html=ui.lobby({total:1,items:[{id:'"><script>',name:'<img onerror=x>',captainName:'<script>',strength:10,memberCount:10,capacity:10,join:{label:'已滿員',disabled:true}}]});
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes(' disabled'));assert.ok(html.includes('清除篩選'));
});
test('member screen never interpolates private supplied fields',()=>{
 const html=ui.publicMembers({name:'隊伍',members:[{name:'小A',role:'captain',ladderPoints:12,hunterTier:'b',lastSeenAt:'PRIVATE',reason:'SECRET',experienceContribution:'XPPRIVATE'}]});
 for(const value of ['PRIVATE','SECRET','XPPRIVATE'])assert.ok(!html.includes(value));assert.ok(html.includes('B級'));
});
test('navigation provides three rankings and empty membership guidance',()=>{
 const html=ui.rankingTabs('team');for(const label of ['天梯','獵人','戰隊'])assert.ok(html.includes(label));
 assert.ok(ui.noTeam().includes('建立戰隊'));assert.ok(ui.tabs('lobby').includes('我的戰隊'));
});
test('loading and errors never render stale available join buttons',()=>{
 assert.ok(ui.lobby({loading:true}).includes('正在載入'));assert.ok(ui.lobby({error:'secret server detail'}).includes('請重試'));assert.ok(!ui.lobby({error:'secret server detail'}).includes('secret server detail'));
});
test('recruitment uses unset defaults and rank dropdowns',()=>{
 const html=ui.recruitmentSettings();assert.equal((html.match(/未指定/g)||[]).length,2);assert.ok(html.includes('青銅以上'));assert.ok(html.includes('國家級以上'));assert.ok(!html.includes('minPoints'));
});
test('create screen handles team membership and safely renders form',()=>{
 assert.ok(ui.createTeam(null).includes('data-team-form="create"'));assert.ok(ui.createTeam({id:'a'}).includes('已有所屬戰隊'));
});
