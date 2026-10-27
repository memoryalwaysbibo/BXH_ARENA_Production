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

test('pending application exposes its status and a cancel control',()=>{
 const html=ui.lobby({items:[{id:'team1',name:'甲',captainName:'乙',memberCount:1,capacity:10,join:{label:'審核中',disabled:true}}],total:1});
 assert.match(html,/審核中/);assert.match(html,/data-team-action="cancel"/);assert.match(html,/取消申請/);
});

test('application list safely presents review actions and remaining count notice',()=>{
 const html=ui.applications({items:[{uid:'p',name:'<script>'}],teamId:'t',hasMore:true});
 assert.ok(!html.includes('<script>'));assert.match(html,/data-team-action="approve"/);assert.match(html,/data-team-action="reject"/);assert.match(html,/還有其他申請/);
});

test('application date and time are displayed separately in Taipei time',()=>{
 const html=ui.applications({items:[{uid:'p',name:'小明',requestedAt:Date.parse('2026-10-27T07:30:00Z')}],teamId:'t'});
 assert.match(html,/申請日期：2026\/10\/27<\/div><div>申請時間：15:30/);
 assert.match(ui.applications({items:[{uid:'p',name:'小明'}],teamId:'t'}),/申請日期：未提供/);
});

test('application review offers a manual refresh for changes made by others',()=>{
 const html=ui.applications({teamId:'t'});assert.match(html,/data-team-action="reload-applications"/);assert.match(html,/重新整理名單/);
});

test('history shows separate fields and escapes record content',()=>{
 const html=ui.history({items:[{name:'<小賈>',date:'2026/10/27',time:'18:10',method:'隊長移除'}]});
 assert.match(html,/<th>姓名<\/th><th>日期<\/th><th>時間<\/th><th>方式/);assert.match(html,/&lt;小賈&gt;/);assert.match(html,/18:10/);assert.doesNotMatch(html,/<小賈>/);
});

test('history offers previous and next buttons only when available',()=>{
 const first=ui.history({page:1,nextCursor:'next'});assert.match(first,/下一頁/);assert.doesNotMatch(first,/上一頁/);
 const second=ui.history({page:2});assert.match(second,/上一頁/);assert.doesNotMatch(second,/下一頁/);assert.match(second,/第 2 頁/);
});
test('member removal form enforces visible role limits and escapes names',()=>{
 const members=[{uid:'c',name:'隊長',role:'captain'},{uid:'d',name:'副隊長',role:'deputy'},{uid:'m',name:'<玩家>',role:'member'}];
 const captain=ui.manageMembers({id:'t',viewerRole:'captain',members});assert.equal((captain.match(/data-team-form="remove"/g)||[]).length,2);assert.match(captain,/data-other-reason hidden/);assert.match(captain,/value="other"/);assert.doesNotMatch(captain,/<玩家>/);
 const deputy=ui.manageMembers({id:'t',viewerRole:'deputy',members});assert.equal((deputy.match(/data-team-form="remove"/g)||[]).length,1);assert.match(deputy,/data-target-uid="m"/);
});
