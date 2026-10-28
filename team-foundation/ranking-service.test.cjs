'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createRankingService}=require('./ranking-service.cjs');
function fixture(frame=null,reads=[],mutate=()=>{}){
 const data=new Map([['hunterLeaderboardMeta/current',{generation:'g'}],['ladderSystem/current',{currentSeason:'S1'}]]);
 const docs=[['a',100,'g'],['b',100,'g'],['c',20,'g'],['bad',null,'g'],['stale',999,'old']].map(([id,points,generation])=>{const xp=frame!==null&&id==='a'?12:0,team={status:'active',name:id,captainUid:id,memberUids:[id],totalXp:xp,selectedFrame:id==='a'?frame:null,emblemObject:id==='a'&&frame!==null?'teamEmblemsV1/'+id+'/'+('a'.repeat(64))+'.webp':null};data.set('teamsV1/'+id,team);return{id,data:()=>({name:id,captainName:id,level:xp?4:1,memberCount:1,strength:points,strengthComplete:points!==null,hunterGeneration:generation,ladderSeason:'S1',members:[{uid:id,role:'captain',ladderPoints:points}],secret:'private',selectedFrame:10})};});
 mutate(data);
 const db={doc:p=>p,collection:()=>({limit:n=>({n})}),runTransaction:fn=>fn({get:async p=>{reads.push(p);return typeof p==='object'?{docs:docs.slice(0,p.n)}:{exists:data.has(p),data:()=>data.get(p)}}})};
 return createRankingService({db});
}
test('ranking sums only complete current projections, ties share rank and stale teams are flagged',async()=>{
 const r=await fixture()({actorUid:'u'});assert.deepEqual(r.items.map(x=>[x.id,x.rank,x.strength]),[['a',1,100],['b',1,100],['c',3,20]]);assert.equal(r.excluded,2);assert.equal(r.partial,true);assert.equal(JSON.stringify(r).includes('private'),false);
});
test('ranking exposes only the current unlocked authoritative frame',async()=>{
 assert.equal((await fixture(4)({actorUid:'u'})).items[0].selectedFrame,4);assert.equal((await fixture(4)({actorUid:'u'})).items[0].hasEmblem,true);
 assert.equal((await fixture(10)({actorUid:'u'})).items[0].selectedFrame,null);
});
test('ranking pagination preserves global ranks and rejects forged queries',async()=>{
 const f=fixture(),r=await f({actorUid:'u',query:{offset:1,limit:1}});assert.equal(r.items[0].rank,1);await assert.rejects(f({actorUid:'u',query:{limit:51}}),/invalid-ranking/);await assert.rejects(f({actorUid:'u',query:{actorUid:'x'}}),/invalid-ranking/);
});

test('stale and incomplete projections do not consume canonical team reads',async()=>{
 const reads=[];const result=await fixture(null,reads)({actorUid:'u'});
 assert.equal(result.excluded,2);assert.deepEqual(reads.filter(p=>typeof p==='string'&&p.startsWith('teamsV1/')).sort(),['teamsV1/a','teamsV1/b','teamsV1/c']);
 assert.equal(result.items.length,3);assert.equal(result.items[1].rank,1);
});

test('projection prefilter never bypasses canonical roster and name checks',async()=>{
 for(const mutate of [data=>{data.get('teamsV1/a').status='dissolved';},data=>{data.get('teamsV1/a').name='changed';},data=>{data.get('teamsV1/a').memberUids=['someoneElse'];}]){
 const r=await fixture(null,[],mutate)({actorUid:'u'});assert.ok(!r.items.some(t=>t.id==='a'));assert.equal(r.excluded,3);assert.equal(r.items[0].rank,1);
 }
});
