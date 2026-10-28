'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {publicTeam,joinState,browseLobby}=require('./lobby.cjs');
const raw={id:'a',name:'嘻哈戰隊',captainUid:'c',memberUids:['c'],totalXp:0,createdAt:10,admission:{mode:'auto'},secret:'secret',history:['private']};
const players={c:{name:'小A',ladderPoints:2900,hunterTier:'b',lastSeenAt:100,experienceContribution:50}};
const team=()=>publicTeam(raw,players);
test('public members expose only approved fields',()=>{
 const t=team();assert.equal(t.strength,2900);assert.equal(t.captainName,'小A');
 assert.deepEqual(Object.keys(t.members[0]).sort(),['uid','name','role','ladderPoints','hunterTier'].sort());
 assert.equal(JSON.stringify(t).includes('lastSeen'),false);assert.equal(JSON.stringify(t).includes('secret'),false);
});
test('join statuses respect membership, pending, capacity and auto eligibility',()=>{
 const t=team();assert.equal(joinState(t).action,'join');assert.equal(joinState(t,{membershipTeamId:'a'}).action,'view');
 assert.equal(joinState(t,{membershipTeamId:'b'}).label,'已有所屬戰隊');assert.equal(joinState(t,{pendingTeamIds:['a']}).label,'審核中');
 assert.equal(joinState({...t,memberCount:10}).label,'已滿員');
 const restricted={...t,admission:{mode:'auto',minLadderTier:'黃金',minTier:'b'}};
 assert.deepEqual(joinState(restricted),{label:'加入',disabled:false,action:'join'});assert.equal(joinState(restricted,{player:{ladderPoints:299,hunterTier:'b'}}).label,'未達條件');
 assert.equal(joinState({...restricted,admission:{...restricted.admission,mode:'review'}}).action,'apply');
});
test('search and combined filters work for already affiliated viewers',()=>{
 const a=team(),b={...a,id:'b',name:'隆隆戰隊',captainName:'小恩',strength:2800,admission:{mode:'review',minLadderTier:null,minTier:null}};
 assert.equal(browseLobby([a,b],{query:'小恩'},{}).items[0].id,'b');
 assert.equal(browseLobby([a,b],{mode:'auto',recruitment:'open'},{membershipTeamId:'b'}).items[0].join.disabled,true);
 assert.equal(browseLobby([a,b],{pendingOnly:true},{pendingTeamIds:['b']}).total,1);
 assert.equal(browseLobby([a,b],{eligibleOnly:true}).total,1);
 assert.throws(()=>browseLobby([a],{limit:51}));
});
test('all lobby sort choices order both directions and keep unknown strength last',()=>{
 const a={...team(),id:'a',strength:300,createdAt:10,memberCount:2,level:1},b={...team(),id:'b',strength:100,createdAt:20,memberCount:5,level:3},c={...team(),id:'c',strength:null,createdAt:15,memberCount:3,level:2};
 const expected={strength_desc:'abc',strength_asc:'bac',created_desc:'bca',created_asc:'acb',members_desc:'bca',members_asc:'acb',level_desc:'bca',level_asc:'acb'};
 for(const [sort,order] of Object.entries(expected))assert.equal(browseLobby([c,b,a],{sort}).items.map(x=>x.id).join(''),order,sort);
 assert.throws(()=>browseLobby([a],{sort:'unknown'}),/invalid-filter/);
});
