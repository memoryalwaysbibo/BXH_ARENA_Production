'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.RDW_HUNTER_BUNDLE_ROOT;
const optional={skip:!root?'verified private Hunter reader bundle unavailable':false};
function fixture(){
 const code='BXH-FIXTURE01',uid='fixtureUid',ts=Date.parse('2026-10-22T12:00:00+08:00');
 const match=n=>({id:'m'+n,completed:true,isBye:false,a:{playerId:'p1'},b:{playerId:'p'+(n+1)},winnerId:'p1',loserId:'p'+(n+1),scoreA:4,scoreB:0,completedAt:ts+n*10000,log:Array.from({length:4},(_,i)=>({v:1,seq:i+1,side:'A',type:'spin',points:1,t:ts-3600000+i*1000+n*10000}))});
 const state={id:code,meta:{name:'Hunter E fixture',date:'2026-10-22',eventAuthority:'official',formatType:'single',battleMode:'individual'},players:[{id:'p1',name:'Fixture A',uid},{id:'p2',name:'Fixture B',uid:'fixtureOpponent'},{id:'p3',name:'Fixture C',uid:'fixtureOpponent2'}],matches:[match(1),match(2)],startedAt:ts-7200000,completedAt:ts+3600000};
 const docs={['tournaments/'+code+'/registrations/'+uid]:{uid,localPlayerId:'p1',status:'confirmed'},['tournaments/'+code]:{data:JSON.stringify(state),eventAuthority:'official'},['users/'+uid]:{active:true},'users/fixtureOpponent':{active:true},'users/fixtureOpponent2':{active:true}};
 const query=key=>({key,where(){return this;},select(){return this;},limit(){return this;}});
 const writes=[];
 const db={doc:key=>({key}),collection:query,runTransaction:async callback=>callback({get:async ref=>ref.key==='publicTournaments'?{size:1,docs:[{id:code,data:()=>({visibility:'public',eventAuthority:'official',eventDate:'2026-10-22'})}]}:{exists:Object.hasOwn(docs,ref.key),data:()=>docs[ref.key]},set:()=>writes.push('set'),create:()=>writes.push('create'),update:()=>writes.push('update'),delete:()=>writes.push('delete')})};
 return {uid,db,writes};
}
test('official two-win history yields independently verified E grade and no writes',optional,async()=>{
 const {createReader}=require(path.resolve(root,'reader.cjs'));
 const f=fixture();const evidence=await f.db.runTransaction(tx=>createReader({db:f.db})({tx,uid:f.uid}));
 assert.equal(evidence.complete,true);assert.equal(evidence.unresolvedIdentities,0);
 assert.equal(evidence.overview.grade.tier,'e');
 assert.deepEqual({matches:evidence.overview.life.matches,events:evidence.overview.life.events,opponents:evidence.overview.life.opponents},{matches:2,events:1,opponents:2});
 assert.equal(evidence.overview.analysis.overall,100);
 assert.deepEqual(f.writes,[]);
});
test('RDW resolver consumes real E-tier outcome from audited Hunter reader',optional,async()=>{
 const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');
 const f=fixture();const result=await createVerifiedTierResolver({db:f.db,clock:()=>Date.parse('2026-10-23T12:00:00+08:00'),bundleRoot:path.resolve(root)})(f.uid);
 assert.equal(result.ok,true);assert.equal(result.tier,'e');assert.match(result.sourceDigest,/^[a-f0-9]{64}$/);assert.deepEqual(f.writes,[]);
});
