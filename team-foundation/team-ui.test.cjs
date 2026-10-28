'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const ui=require('./team-ui.js');
test('lobby escapes names and IDs and maintains disabled state',()=>{
 const html=ui.lobby({total:1,items:[{id:'"><script>',name:'<img onerror=x>',captainName:'<script>',strength:10,memberCount:10,capacity:10,join:{label:'已滿員',disabled:true}}]});
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes(' disabled'));assert.ok(html.includes('清除篩選'));
});
test('lobby team frames render known variants and ignore arbitrary values',()=>{
 const item={id:'t',name:'隊伍',captainName:'隊長',memberCount:2,capacity:10,join:{label:'加入',disabled:false}};
 assert.match(ui.lobby({items:[{...item,selectedFrame:7}]}),/team-identity team-frame-7/);
 assert.doesNotMatch(ui.lobby({items:[{...item,selectedFrame:'evil'}]}),/team-frame-evil/);
 assert.match(ui.lobby({items:[{...item,emblemSource:'data:image/webp;base64,UklGRgAAAABXRUJQ'}]}),/alt="戰隊圖案"/);
});
test('team detail displays only bounded WebP data images',()=>{
 const team={id:'t',name:'隊伍',members:[],role:'member',emblemSource:'data:image/webp;base64,UklGRgAAAABXRUJQ'};
 assert.match(ui.myTeam(team),/alt="戰隊圖案"/);assert.match(ui.publicMembers(team),/alt="戰隊圖案"/);
 assert.doesNotMatch(ui.myTeam({...team,emblemSource:'javascript:alert(1)'}),/javascript:/);
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
 const html=ui.createTeam(null);assert.equal((html.match(/<svg /g)||[]).length,6);assert.match(html,/name="presetColor"/);assert.match(html,/name="customEmblem"/);
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
test('affiliated applicants cannot be approved but can still be rejected',()=>{
 const html=ui.applications({teamId:'t',items:[{uid:'p',name:'小明',hasTeam:true}]});
 assert.match(html,/已有所屬戰隊，無法核准加入/);
 assert.match(html,/<button[^>]*data-team-action="approve"[^>]* disabled>核准/);
 assert.match(html,/<button[^>]*data-team-action="reject"[^>]*>拒絕/);
 assert.doesNotMatch(html,/<button[^>]*data-team-action="reject"[^>]* disabled/);
 const refreshed=ui.applications({teamId:'t',items:[{uid:'p',name:'小明',hasTeam:false}]});
 assert.doesNotMatch(refreshed,/<button[^>]*data-team-action="approve"[^>]* disabled/);
 assert.doesNotMatch(refreshed,/已有所屬戰隊/);
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

test('only the captain gets role assignment forms for other members',()=>{
 const members=[{uid:'c',name:'隊長',role:'captain'},{uid:'d',name:'副隊長',role:'deputy'},{uid:'m',name:'隊員',role:'member'}];
 const cap=ui.manageMembers({id:'t',viewerRole:'captain',members});assert.equal((cap.match(/data-team-form="assign"/g)||[]).length,2);assert.match(cap,/副隊長最多 2 位/);assert.match(cap,/菁英隊員最多 3 位/);
 assert.doesNotMatch(ui.manageMembers({id:'t',viewerRole:'deputy',members}),/data-team-form="assign"/);
});

test('only the captain can initiate transfer to another member',()=>{
 const members=[{uid:'c',name:'隊長',role:'captain'},{uid:'m',name:'隊員',role:'member'}];
 const cap=ui.manageMembers({id:'t',viewerRole:'captain',members});assert.equal((cap.match(/data-team-action="transfer"/g)||[]).length,1);assert.match(cap,/data-target-uid="m"/);
 assert.doesNotMatch(ui.manageMembers({id:'t',viewerRole:'deputy',members}),/data-team-action="transfer"/);
});

test('exit controls respect captain and solo dissolution conditions',()=>{
 assert.match(ui.myTeam({id:'t',role:'member'}),/data-team-action="leave"/);
 const solo=ui.myTeam({id:'t',role:'captain',memberCount:1});assert.match(solo,/data-team-action="dissolve"/);assert.doesNotMatch(solo,/data-team-action="leave"/);
 const group=ui.myTeam({id:'t',role:'captain',memberCount:2});assert.doesNotMatch(group,/data-team-action="dissolve"/);assert.match(group,/僅剩隊長/);
});
test('my team shows server progression and a bounded experience bar',()=>{
 const html=ui.myTeam({id:'t',name:'試驗隊',role:'member',memberCount:3,level:2,capacity:11,totalXp:6,currentXp:3,nextXp:4,unlockedFrames:[]});
 assert.match(html,/LV 2/);assert.match(html,/成員 3／11/);assert.match(html,/<progress value="3" max="4">/);assert.match(html,/LV4、LV7、LV10/);
 const maximum=ui.myTeam({id:'t',name:'隊',role:'captain',memberCount:1,level:10,capacity:20,totalXp:63,currentXp:null,nextXp:null,unlockedFrames:[4,7,10]});
 assert.match(maximum,/已達最高等級/);assert.doesNotMatch(maximum,/<progress/);
});
test('only the captain can choose an unlocked frame and the saved choice is selected',()=>{
 const team={id:'t',name:'隊伍',role:'captain',memberCount:3,level:7,capacity:16,currentXp:0,nextXp:9,unlockedFrames:[4,7],selectedFrame:7};
 const html=ui.myTeam(team);assert.match(html,/data-team-form="frame"/);assert.match(html,/<option value="7" selected>/);assert.match(html,/<option value="10" disabled>/);assert.doesNotMatch(html.match(/<select name="frame">.*?<\/select>/)[0],/<option value="" selected>/);
 const member=ui.myTeam({...team,role:'member'});assert.match(member,/目前戰隊框：LV 7/);assert.doesNotMatch(member,/data-team-form="frame"/);
 assert.match(html,/data-team-emblem/);assert.doesNotMatch(member,/data-team-emblem/);
 assert.match(member,/class="team-identity team-frame-7"/);assert.match(ui.css,/\.team-frame-7/);
 const invalid=ui.myTeam({...team,selectedFrame:10});assert.doesNotMatch(invalid,/class="team-identity team-frame-10"/);assert.match(invalid,/目前戰隊框：未使用/);
});

test('same-team roster shows escaped login and contribution; public roster hides them',()=>{
 const t={name:'隊伍',members:[{name:'A',role:'member',experienceContribution:4,recentLogin:'<script>登入</script>'}]};
 assert.doesNotMatch(ui.publicMembers(t),/最近登入|經驗貢獻|&lt;script/);
 const html=ui.publicMembers({...t,viewerIsMember:true});assert.match(html,/最近登入/);assert.match(html,/經驗貢獻/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<script>/);
});

test('solo dissolution warning separates Taiwan date and time and disappears after recovery',()=>{
 const team={id:'t',name:'隊伍',role:'captain',memberCount:1,dissolution:{dueAt:Date.UTC(2026,9,28,7,30),overdue:false}};
 const html=ui.myTeam(team);assert.match(html,/戰隊人數不足/);assert.match(html,/解散檢查日期：2026\/10\/28/);assert.match(html,/解散檢查時間：15:30/);assert.doesNotMatch(html,/已到期限/);
 assert.match(ui.myTeam({...team,dissolution:{...team.dissolution,overdue:true}}),/已到期限/);
 assert.doesNotMatch(ui.myTeam({...team,memberCount:2}),/戰隊人數不足/);
 assert.match(ui.createTeam(null),/24 小時內招募至少 1 位隊員/);
});

test('management view includes authorized contribution and login details',()=>{
 const html=ui.manageMembers({id:'t',viewerRole:'captain',viewerIsMember:true,members:[{uid:'a',name:'A',role:'member',experienceContribution:5,recentLogin:'2 小時前'}]});assert.match(html,/經驗貢獻（本次入隊）：5/);assert.match(html,/最近登入：2 小時前/);
});

test('lobby pagination uses requested page size even when stale rows were omitted',()=>{
 const first=ui.lobby({items:[],total:45,offset:0,limit:20,totalIsUpperBound:true});assert.match(first,/lobby-next/);assert.doesNotMatch(first,/lobby-previous/);
 const middle=ui.lobby({items:[],total:45,offset:20,limit:20,totalIsUpperBound:true});assert.match(middle,/lobby-next/);assert.match(middle,/lobby-previous/);
 const last=ui.lobby({items:[],total:45,offset:40,limit:20});assert.doesNotMatch(last,/lobby-next/);assert.match(last,/lobby-previous/);
 assert.doesNotMatch(ui.lobby({loading:true,total:45}),/lobby-next/);
});
test('lobby exposes four sort dimensions in both directions and preserves selection',()=>{
 const html=ui.lobby({sort:'members_asc'});for(const text of ['戰力：由高到低','戰力：由低到高','創隊：由新到舊','創隊：由舊到新','人數：由多到少','人數：由少到多','等級：由高到低','等級：由低到高'])assert.ok(html.includes(text));assert.match(html,/value="members_asc" selected/);
});
test('create screen shows capacity and replaces the form when full or unavailable',()=>{
 assert.match(ui.createTeam(null,{status:'open',activeCount:199,limit:200}),/199／200/);
 for(const status of ['full','unavailable']){const html=ui.createTeam(null,{status,activeCount:null,limit:200});assert.doesNotMatch(html,/data-team-form="create"/);assert.match(html,/重新整理名額/);assert.match(html,/前往戰隊大廳/);}
 assert.match(ui.createTeam(null,{status:'full',activeCount:200,limit:200}),/已達 200 支上限/);
});
