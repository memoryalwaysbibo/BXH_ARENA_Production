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
 assert.equal(joinState(restricted).label,'資格待確認');assert.equal(joinState(restricted,{player:{ladderPoints:299,hunterTier:'b'}}).label,'未達條件');
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
