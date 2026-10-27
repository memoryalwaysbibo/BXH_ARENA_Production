'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createListService}=require('./list-service.cjs');
function setup({count=2,stale=false,membership=null,pending=false}={}){
 const data=new Map([['hunterLeaderboardMeta/current',{generation:'g'}],['ladderSystem/current',{currentSeason:'S1'}]]);
 if(membership)data.set('teamMembershipsV1/u',{teamId:membership});
 const docs=Array.from({length:count},(_,i)=>{const id='t'+i,p={name:'戰隊'+i,captainName:'隊長',level:1,capacity:10,memberCount:1,strength:i===0?null:100,createdAt:100,admission:{mode:'auto',minPoints:null,minTier:null},hunterGeneration:stale&&i===0?'old':'g',ladderSeason:'S1',members:[{uid:'c',role:'captain'}],secret:'private'};data.set('teamsV1/'+id,{status:'active',captainUid:'c',memberUids:['c']});return{id,data:()=>p};});
 if(pending)data.set('teamsV1/t1/applications/u',{status:'pending'});
 const db={doc:p=>p,collection:()=>({limit:n=>({kind:'query',n})}),runTransaction:fn=>fn({get:async p=>typeof p==='object'?{docs:docs.slice(0,p.n)}:{exists:data.has(p),data:()=>data.get(p)}})};
 return createListService({db});
}
test('list returns matching projected summaries without member internals',async()=>{
 const list=setup({pending:true});const r=await list({actorUid:'u',query:{query:'戰隊',limit:20}});assert.equal(r.total,2);assert.equal(r.items[0].id,'t1');assert.equal(r.items[0].join.label,'審核中');assert.equal(r.items[1].strength,null);assert.ok(!JSON.stringify(r).includes('private'));assert.ok(!JSON.stringify(r).includes('memberUids'));
});
test('already affiliated can browse but cannot join others',async()=>{const list=setup({membership:'t0'});const r=await list({actorUid:'u'});assert.equal(r.items.find(x=>x.id==='t0').join.label,'我的戰隊');assert.equal(r.items.find(x=>x.id==='t1').join.label,'已有所屬戰隊');});
test('stale projections are omitted with partial warning; oversized result fails closed',async()=>{
 const r=await setup({stale:true})({actorUid:'u'});assert.equal(r.total,1);assert.equal(r.staleCount,1);assert.equal(r.partial,true);
 await assert.rejects(setup({count:201})({actorUid:'u'}),/capacity-exceeded/);
});
test('untrusted query fields, unsupported filters and oversized requests rejected',async()=>{
 const list=setup();for(const query of [{actorUid:'other'},{limit:51},{mode:'bad'},{query:'x'.repeat(101)}])await assert.rejects(list({actorUid:'u',query}));
});
