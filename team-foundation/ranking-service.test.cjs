'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createRankingService}=require('./ranking-service.cjs');
function fixture(frame=null){
 const data=new Map([['hunterLeaderboardMeta/current',{generation:'g'}],['ladderSystem/current',{currentSeason:'S1'}]]);
 const docs=[['a',100,'g'],['b',100,'g'],['c',20,'g'],['bad',null,'g'],['stale',999,'old']].map(([id,points,generation])=>{const xp=frame!==null&&id==='a'?12:0,team={status:'active',name:id,captainUid:id,memberUids:[id],totalXp:xp,selectedFrame:id==='a'?frame:null};data.set('teamsV1/'+id,team);return{id,data:()=>({name:id,captainName:id,level:xp?4:1,memberCount:1,strength:points,strengthComplete:points!==null,hunterGeneration:generation,ladderSeason:'S1',members:[{uid:id,role:'captain',ladderPoints:points}],secret:'private',selectedFrame:10})};});
 const db={doc:p=>p,collection:()=>({limit:n=>({n})}),runTransaction:fn=>fn({get:async p=>typeof p==='object'?{docs:docs.slice(0,p.n)}:{exists:data.has(p),data:()=>data.get(p)}})};
 return createRankingService({db});
}
test('ranking sums only complete current projections, ties share rank and stale teams are flagged',async()=>{
 const r=await fixture()({actorUid:'u'});assert.deepEqual(r.items.map(x=>[x.id,x.rank,x.strength]),[['a',1,100],['b',1,100],['c',3,20]]);assert.equal(r.excluded,2);assert.equal(r.partial,true);assert.equal(JSON.stringify(r).includes('private'),false);
});
test('ranking exposes only the current unlocked authoritative frame',async()=>{
 assert.equal((await fixture(4)({actorUid:'u'})).items[0].selectedFrame,4);
 assert.equal((await fixture(10)({actorUid:'u'})).items[0].selectedFrame,null);
});
test('ranking pagination preserves global ranks and rejects forged queries',async()=>{
 const f=fixture(),r=await f({actorUid:'u',query:{offset:1,limit:1}});assert.equal(r.items[0].rank,1);await assert.rejects(f({actorUid:'u',query:{limit:51}}),/invalid-ranking/);await assert.rejects(f({actorUid:'u',query:{actorUid:'x'}}),/invalid-ranking/);
});
