'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReadService}=require('./read-service.cjs');
function fixture(uidRole='deputy'){
 const data=new Map([['teamsV1/t',{status:'active',captainUid:'captain',memberUids:['captain','u'],roles:{u:uidRole}}],['teamMembershipsV1/u',{teamId:'t'}],['publicPlayers/p',{publicName:'小明',email:'private'}]]);let queried=false;const applicants=Array.from({length:1},()=>({id:'p',data:()=>({requestedAt:10,secret:'private'})}));
 const db={doc:p=>p,collection:p=>({where:(field,op,value)=>({orderBy:key=>{assert.equal(key,'__name__');const q={limit:n=>({path:p,field,op,value,n}),startAfter:cursor=>({limit:n=>({path:p,field,op,value,n,cursor})})};return q;}})}),runTransaction:fn=>fn({get:async p=>{if(typeof p==='object'){queried=true;assert.equal(p.value,'pending');assert.equal(p.n,21);return {docs:applicants.filter(a=>!p.cursor||a.id>p.cursor).slice(0,p.n)};}return {exists:data.has(p),data:()=>data.get(p)};}})};
 return {read:createReadService({db}),data,applicants,get queried(){return queried;}};
}
test('captain and deputy can retrieve bounded pending applications with only public fields',async()=>{
 for(const role of ['captain','deputy']){const f=fixture(role);if(role==='captain')f.data.get('teamsV1/t').captainUid='u';const result=await f.read({actorUid:'u',action:'applications',teamId:'t'});assert.deepEqual(result,{items:[{uid:'p',name:'小明',requestedAt:10,hasTeam:false}],hasMore:false,nextCursor:null});assert.equal(JSON.stringify(result).includes('private'),false);}
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
test('application cursor pages beyond 20 and survives removal of the anchor',async()=>{
 const f=fixture();f.applicants.splice(0,1,...Array.from({length:23},(_,i)=>({id:'p'+String(i).padStart(2,'0'),data:()=>({requestedAt:10})})));
 const first=await f.read({actorUid:'u',action:'applications',teamId:'t'});
 assert.equal(first.items.length,20);assert.equal(first.nextCursor,'p19');assert.equal(first.hasMore,true);
 f.applicants.splice(19,1);
 const next=await f.read({actorUid:'u',action:'applications',teamId:'t',cursor:first.nextCursor});
 assert.deepEqual(next.items.map(x=>x.uid),['p20','p21','p22']);assert.equal(next.nextCursor,null);assert.equal(next.hasMore,false);
 await assert.rejects(f.read({actorUid:'u',action:'applications',teamId:'t',cursor:'../other'}),/invalid-application-cursor/);
});
