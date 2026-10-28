'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createReadService}=require('./read-service.cjs');
function setup(){
 const data=new Map([
 ['teamsV1/t',{captainUid:'c',memberUids:['c','d','m'],roles:{d:'deputy'},status:'active',totalXp:6}],
 ['teamMembershipsV1/c',{teamId:'t'}],['teamMembershipsV1/d',{teamId:'t'}],['teamMembershipsV1/m',{teamId:'t'}],
 ['teamsV1/t/history/h',{subjectUid:'gone',subjectName:'小賈',actorName:'黑爸',actorRole:'captain',method:'remove',occurredAt:1793095800000}],
 ['teamsV1/t/historyReasons/h',{code:'other',label:'其他',note:'私有說明',subjectUid:'gone'}],
 ['hunterLeaderboardMeta/current',{generation:'g'}],['ladderSystem/current',{currentSeason:'S1'}],
 ['teamsPublicV1/t',{name:'隊伍',hunterGeneration:'g',ladderSeason:'S1',members:[{uid:'c',name:'黑爸',role:'captain',ladderPoints:12,hunterTier:'b',secret:'PRIVATE'},{uid:'d',name:'D',role:'deputy'},{uid:'m',name:'M',role:'member'}],secret:'PRIVATE'}]
 ]);const reads=[];
 const db={doc:p=>p,collection:p=>({orderBy:()=>({limit:n=>({path:p,limit:n})})}),runTransaction:fn=>fn({get:async p=>{reads.push(p);if(typeof p==='object')return {docs:[{id:'h',data:()=>data.get('teamsV1/t/history/h')}]};return {exists:data.has(p),data:()=>data.get(p)};}})};
 return {read:createReadService({db}),data,reads};
}
test('public member endpoint excludes unexpected fields',async()=>{const f=setup();const r=await f.read({actorUid:'outsider',action:'members',teamId:'t'});assert.equal(JSON.stringify(r).includes('PRIVATE'),false);assert.equal(f.reads.length,5);});
test('history requires current membership and returns separate date/time without reason',async()=>{
 const f=setup();await assert.rejects(f.read({actorUid:'outsider',action:'history',teamId:'t'}),/permission/);
 const r=await f.read({actorUid:'m',action:'history',teamId:'t'});assert.ok(r.items[0].date);assert.ok(r.items[0].time);assert.equal(JSON.stringify(r).includes('私有說明'),false);assert.equal(r.pageLimit,50);
});
test('reason is visible to subject and current leadership; stale roles do not authorize',async()=>{
 for(const uid of ['c','d','gone']){const f=setup();assert.equal((await f.read({actorUid:uid,action:'reason',teamId:'t',historyId:'h'})).note,'私有說明');}
 for(const uid of ['m','outsider']){const f=setup();await assert.rejects(f.read({actorUid:uid,action:'reason',teamId:'t',historyId:'h'}),/permission/);assert.ok(!f.reads.some(p=>typeof p==='string'&&p.includes('historyReasons')));}
 const f=setup();f.data.delete('teamMembershipsV1/d');await assert.rejects(f.read({actorUid:'d',action:'reason',teamId:'t',historyId:'h'}),/permission/);
});

test('old projection is withheld during roster, tier generation and season changes',async()=>{for(const kind of ['roster','generation','season']){const f=setup();if(kind==='roster')f.data.get('teamsV1/t').memberUids.pop();if(kind==='generation')f.data.get('hunterLeaderboardMeta/current').generation='new';if(kind==='season')f.data.get('ladderSystem/current').currentSeason='S2';await assert.rejects(f.read({actorUid:'outsider',action:'members',teamId:'t'}),/projection-stale/);}});
test('mine resolves team only from authenticated actor, settings visible only to leadership',async()=>{
 const f=setup();let result=await f.read({actorUid:'c',action:'mine'});assert.equal(result.team.id,'t');assert.equal(result.team.role,'captain');assert.equal(result.team.memberCount,3);assert.equal(result.team.admission.mode,'review');
 assert.equal(result.team.level,2);assert.equal(result.team.capacity,11);assert.equal(result.team.currentXp,3);assert.equal(result.team.nextXp,4);assert.deepEqual(result.team.unlockedFrames,[]);
 result=await f.read({actorUid:'d',action:'mine'});assert.equal(result.team.role,'deputy');assert.ok(result.team.admission);
 result=await f.read({actorUid:'m',action:'mine'});assert.equal(result.team.admission,null);
 assert.equal((await f.read({actorUid:'outsider',action:'mine'})).team,null);
 f.data.get('teamsV1/t').memberUids=f.data.get('teamsV1/t').memberUids.filter(x=>x!=='d');await assert.rejects(f.read({actorUid:'d',action:'mine'}),/membership-unavailable/);
});
test('card team lookup honors player card privacy and reveals only public fields',async()=>{
 const f=setup();f.data.get('teamsV1/t').name='測試隊';f.data.get('teamsV1/t').privateNote='SECRET';
 await assert.rejects(f.read({actorUid:'outsider',action:'card-team',targetUid:'m'}),/permission-denied/);
 assert.ok(!f.reads.includes('teamMembershipsV1/m'));
 f.data.set('playerPrivacy/m',{cardPublic:true});const r=await f.read({actorUid:'outsider',action:'card-team',targetUid:'m'});
 assert.deepEqual(r,{team:{id:'t',name:'測試隊',role:'member',level:2,selectedFrame:null,preset:{id:'shield',color:'#EC536E'},hasEmblem:false}});assert.ok(!JSON.stringify(r).includes('SECRET'));
 const own=await f.read({actorUid:'c',action:'card-team',targetUid:'c'});assert.equal(own.team.role,'captain');
 f.data.get('teamsV1/t').emblemObject='teamEmblemsV1/t/'+('a'.repeat(64))+'.webp';const withImage=await f.read({actorUid:'outsider',action:'card-team',targetUid:'m'});assert.equal(withImage.team.hasEmblem,true);assert.ok(!JSON.stringify(withImage).includes('teamEmblemsV1'));
 f.data.set('playerPrivacy/solo',{cardPublic:true});assert.deepEqual(await f.read({actorUid:'outsider',action:'card-team',targetUid:'solo'}),{team:null});
 f.data.get('teamsV1/t').memberUids=f.data.get('teamsV1/t').memberUids.filter(x=>x!=='m');await assert.rejects(f.read({actorUid:'outsider',action:'card-team',targetUid:'m'}),/membership-unavailable/);
});

test('mine shows only the authenticated membership contribution',async()=>{const f=setup();f.data.get('teamMembershipsV1/c').experienceContribution=9;f.data.get('teamMembershipsV1/m').experienceContribution=2;assert.equal((await f.read({actorUid:'c',action:'mine'})).team.experienceContribution,9);assert.equal((await f.read({actorUid:'m',action:'mine'})).team.experienceContribution,2);assert.ok(!JSON.stringify(await f.read({actorUid:'outsider',action:'members',teamId:'t'})).includes('experienceContribution'));});

test('member-only login and contribution require matching canonical membership',async()=>{
 const f=setup();f.data.set('users/c',{lastLoginAt:100,email:'PRIVATE_EMAIL'});f.data.get('teamMembershipsV1/c').experienceContribution=5;
 let r=await f.read({actorUid:'m',action:'members',teamId:'t'});assert.equal(r.viewerIsMember,true);assert.equal(r.members[0].experienceContribution,5);assert.ok(r.members[0].recentLogin);assert.ok(!JSON.stringify(r).includes('PRIVATE_EMAIL'));
 f.reads.length=0;r=await f.read({actorUid:'outsider',action:'members',teamId:'t'});assert.equal(r.viewerIsMember,false);assert.ok(!f.reads.some(p=>p.startsWith('users/')));assert.ok(!JSON.stringify(r).includes('recentLogin'));
 f.data.get('teamsV1/t').memberUids=['c','d'];f.data.get('teamsPublicV1/t').members.pop();
 r=await f.read({actorUid:'m',action:'members',teamId:'t'});assert.equal(r.viewerIsMember,false);
});
test('missing or future login timestamps never claim that a player is online',async()=>{
 const f=setup();f.data.set('users/c',{lastLoginAt:Number.MAX_SAFE_INTEGER});
 const r=await f.read({actorUid:'m',action:'members',teamId:'t'});assert.equal(r.members[0].recentLogin,'尚無紀錄');assert.equal(r.members[1].recentLogin,'尚無紀錄');
});

test('solo teams expose the server dissolution deadline only on mine; recovered teams clear warning',async()=>{
 const f=setup(),team=f.data.get('teamsV1/t');team.memberUids=['c'];team.dissolveAt=1;
 let r=await f.read({actorUid:'c',action:'mine'});assert.deepEqual(r.team.dissolution,{dueAt:1,overdue:true});
 team.dissolveAt=Number.MAX_SAFE_INTEGER;r=await f.read({actorUid:'c',action:'mine'});assert.equal(r.team.dissolution.overdue,false);
 team.memberUids=['c','m'];assert.equal((await f.read({actorUid:'c',action:'mine'})).team.dissolution,null);
 team.memberUids=['c'];team.dissolveAt=null;assert.equal((await f.read({actorUid:'c',action:'mine'})).team.dissolution,null);
});
