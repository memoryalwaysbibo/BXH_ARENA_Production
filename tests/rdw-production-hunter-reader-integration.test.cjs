'use strict';
// P3-20: run with RDW_HUNTER_BUNDLE_ROOT pointing to the private audited ZIP extraction.
// Normal CI without that bundle reports SKIP; do not claim integration CI passed on a skip.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');
const root=process.env.RDW_HUNTER_BUNDLE_ROOT;
function fixture({event=false,broken=false,user={active:true}}={}){
 const uid='fixtureUid',code='BXH-FIXTURE1',writes=[];
 const data={
  ['users/'+uid]:user,
  'users/oppUid':{active:true},
  ['tournaments/'+code+'/registrations/'+uid]:{uid,localPlayerId:'player1',status:'confirmed'},
  ['tournaments/'+code]:broken?{eventAuthority:'official',data:{players:[],matches:[],startedAt:123}}:{
    eventAuthority:'official',
    data:{
     players:[{id:'player1',accountUid:uid,name:'A'},{id:'player2',accountUid:'oppUid',name:'B'}],
     matches:[{id:'match1',a:{playerId:'player1'},b:{playerId:'player2'},completed:true,winnerId:'player1',scoreA:4,scoreB:2,log:[]}],
     startedAt:123,completedAt:124
    }
   }
 };
 const db={
  doc:key=>({key}),
  collection:key=>({key,where(){return this;},select(){return this;},limit(){return this;}}),
  runTransaction:async fn=>fn({
   get:async ref=>{
    if(ref.key==='publicTournaments')return {size:event?1:0,docs:event?[{id:code,data:()=>({eventAuthority:'official',testMode:false})}]:[]};
    if(['playerEventResults','ladderTransactions'].includes(ref.key))return {size:0,docs:[]};
    const row=data[ref.key];return {exists:!!row,data:()=>row};
   },
   set:()=>writes.push('set'),create:()=>writes.push('create'),update:()=>writes.push('update'),delete:()=>writes.push('delete')
  })
 };
 return {db,writes};
}
const integration={skip:!root?'private RDW_HUNTER_BUNDLE_ROOT not provisioned':false};
test('actual production Reader: empty history is ungraded and read-only',integration,async()=>{
 const f=fixture(),resolve=createVerifiedTierResolver({db:f.db,clock:()=>Date.now(),bundleRoot:path.resolve(root)});
 const r=await resolve('fixtureUid');
 assert.equal(r.ok,true);assert.equal(r.tier,'ungraded');
 assert.equal(r.sourceScope,'public-official-canonical-self-history-v1');
 assert.match(r.sourceDigest,/^[a-f0-9]{64}$/);assert.deepEqual(f.writes,[]);
});
test('actual production Reader: completed match included in canonical history',integration,async()=>{
 const f=fixture({event:true}),resolve=createVerifiedTierResolver({db:f.db,clock:()=>Date.now(),bundleRoot:path.resolve(root)});
 const r=await resolve('fixtureUid');
 assert.equal(r.ok,true);assert.equal(r.tier,'ungraded');
 assert.equal(r.sourceScope,'public-official-canonical-self-history-v1');
 assert.deepEqual(f.writes,[]);
});
test('actual production Reader: incomplete canonical event is rejected',integration,async()=>{
 const f=fixture({event:true,broken:true}),resolve=createVerifiedTierResolver({db:f.db,clock:()=>Date.now(),bundleRoot:path.resolve(root)});
 const r=await resolve('fixtureUid');assert.equal(r.ok,false);assert.deepEqual(f.writes,[]);
});
test('actual production Reader: inactive account cannot be resolved',integration,async()=>{
 const f=fixture({user:{active:false}}),resolve=createVerifiedTierResolver({db:f.db,clock:()=>Date.now(),bundleRoot:path.resolve(root)});
 const r=await resolve('fixtureUid');assert.equal(r.ok,false);assert.deepEqual(f.writes,[]);
});
