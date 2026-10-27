'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createRankingService}=require('./ranking-service.cjs');
function fixture(){
 const data=new Map([['hunterLeaderboardMeta/current',{generation:'g'}],['ladderSystem/current',{currentSeason:'S1'}]]);
 const docs=[['a',100,'g'],['b',100,'g'],['c',20,'g'],['bad',null,'g'],['stale',999,'old']].map(([id,points,generation])=>{const team={status:'active',name:id,captainUid:id,memberUids:[id],totalXp:0};data.set('teamsV1/'+id,team);return{id,data:()=>({name:id,captainName:id,level:1,memberCount:1,strength:points,strengthComplete:points!==null,hunterGeneration:generation,ladderSeason:'S1',members:[{uid:id,role:'captain',ladderPoints:points}],secret:'private'})};});
 const db={doc:p=>p,collection:()=>({limit:n=>({n})}),runTransaction:fn=>fn({get:async p=>typeof p==='object'?{docs:docs.slice(0,p.n)}:{exists:data.has(p),data:()=>data.get(p)}})};
 return createRankingService({db});
}
test('ranking sums only complete current projections, ties share rank and stale teams are flagged',async()=>{
 const r=await fixture()({actorUid:'u'});assert.deepEqual(r.items.map(x=>[x.id,x.rank,x.strength]),[['a',1,100],['b',1,100],['c',3,20]]);assert.equal(r.excluded,2);assert.equal(r.partial,true);assert.equal(JSON.stringify(r).includes('private'),false);
});
test('ranking pagination preserves global ranks and rejects forged queries',async()=>{
 const f=fixture(),r=await f({actorUid:'u',query:{offset:1,limit:1}});assert.equal(r.items[0].rank,1);await assert.rejects(f({actorUid:'u',query:{limit:51}}),/invalid-ranking/);await assert.rejects(f({actorUid:'u',query:{actorUid:'x'}}),/invalid-ranking/);
});
