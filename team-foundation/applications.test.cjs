'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReadService}=require('./read-service.cjs');
function fixture(uidRole='deputy'){
 const data=new Map([['teamsV1/t',{status:'active',captainUid:'captain',memberUids:['captain','u'],roles:{u:uidRole}}],['teamMembershipsV1/u',{teamId:'t'}],['publicPlayers/p',{publicName:'小明',email:'private'}]]);let queried=false;
 const db={doc:p=>p,collection:p=>({where:(field,op,value)=>({limit:n=>({path:p,field,op,value,n})})}),runTransaction:fn=>fn({get:async p=>{if(typeof p==='object'){queried=true;assert.equal(p.value,'pending');assert.equal(p.n,21);return {docs:[{id:'p',data:()=>({requestedAt:10,secret:'private'})}]};}return {exists:data.has(p),data:()=>data.get(p)};}})};
 return {read:createReadService({db}),data,get queried(){return queried;}};
}
test('captain and deputy can retrieve bounded pending applications with only public fields',async()=>{
 for(const role of ['captain','deputy']){const f=fixture(role);if(role==='captain')f.data.get('teamsV1/t').captainUid='u';const result=await f.read({actorUid:'u',action:'applications',teamId:'t'});assert.deepEqual(result,{items:[{uid:'p',name:'小明',requestedAt:10,hasTeam:false}],hasMore:false});assert.equal(JSON.stringify(result).includes('private'),false);}
});
test('non-leaders and former members cannot query applications',async()=>{
 for(const mode of ['member','removed']){const f=fixture(mode==='member'?'member':'deputy');if(mode==='removed')f.data.delete('teamMembershipsV1/u');await assert.rejects(f.read({actorUid:'u',action:'applications',teamId:'t'}),/permission-denied/);assert.equal(f.queried,false);}
});
test('review status follows current membership without disclosing its contents',async()=>{
 const f=fixture();f.data.set('teamMembershipsV1/p',{teamId:'other-private-team',tenureId:'private-tenure',experienceContribution:999});
 let result=await f.read({actorUid:'u',action:'applications',teamId:'t'});
 assert.deepEqual(result.items[0],{uid:'p',name:'小明',requestedAt:10,hasTeam:true});
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('999'));
 f.data.delete('teamMembershipsV1/p');result=await f.read({actorUid:'u',action:'applications',teamId:'t'});
 assert.equal(result.items[0].hasTeam,false);
});
