'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.RDW_HUNTER_BUNDLE_ROOT;
function fixture({winnerConflict=false}={}){
 const uid='fixtureUid',code='BXH-FIXTURE01',ts=Date.parse('2026-10-22T12:00:00+08:00');
 const match={id:'match_1',completed:true,isBye:false,a:{playerId:'p1'},b:{playerId:'p2'},winnerId:winnerConflict?'p2':'p1',loserId:'p2',scoreA:4,scoreB:0,completedAt:ts,log:Array.from({length:4},(_,i)=>({v:1,seq:i+1,side:'A',type:'spin',points:1,t:ts-3600000+i*1000}))};
 const state={id:code,meta:{name:'Hunter fixture',date:'2026-10-22',eventAuthority:'official',formatType:'single',battleMode:'individual'},players:[{id:'p1',name:'Fixture A',uid},{id:'p2',name:'Fixture B',uid:'fixtureOpponent'}],matches:[match],startedAt:ts-7200000,completedAt:ts+3600000};
 const docs={['tournaments/'+code+'/registrations/'+uid]:{uid,localPlayerId:'p1',status:'confirmed'},['tournaments/'+code]:{data:JSON.stringify(state),eventAuthority:'official'},['users/'+uid]:{active:true},'users/fixtureOpponent':{active:true}};
 const writes=[];
 const db={doc:key=>({key}),collection:key=>({key,where(){return this;},select(){return this;},limit(){return this;}}),runTransaction:async callback=>callback({get:async ref=>ref.key==='publicTournaments'?{size:1,docs:[{id:code,data:()=>({visibility:'public',eventAuthority:'official',eventDate:'2026-10-22'})}]}:{exists:Object.hasOwn(docs,ref.key),data:()=>docs[ref.key]},set:()=>writes.push('set'),create:()=>writes.push('create'),update:()=>writes.push('update'),delete:()=>writes.push('delete')})};
 return {db,uid,writes};
}
const maybe={skip:!root?'requires verified Hunter production source bundle':false};
test('official completed match contributes current-tier evidence without writes',maybe,async()=>{
 const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');
 const f=fixture();const result=await createVerifiedTierResolver({db:f.db,clock:()=>Date.parse('2026-10-23T12:00:00+08:00'),bundleRoot:path.resolve(root)})(f.uid);
 assert.equal(result.ok,true);assert.equal(result.tier,'ungraded');assert.match(result.sourceDigest,/^[a-f0-9]{64}$/);assert.deepEqual(f.writes,[]);
});
test('winner and score conflict fail closed without writes',maybe,async()=>{
 const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');
 const f=fixture({winnerConflict:true});const result=await createVerifiedTierResolver({db:f.db,clock:()=>Date.parse('2026-10-23T12:00:00+08:00'),bundleRoot:path.resolve(root)})(f.uid);
 assert.equal(result.ok,false);assert.equal(result.reason,'incomplete-server-history');assert.deepEqual(f.writes,[]);
});