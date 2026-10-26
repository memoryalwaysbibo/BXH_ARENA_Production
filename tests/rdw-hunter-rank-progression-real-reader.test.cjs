'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const bundleRoot=process.env.RDW_HUNTER_BUNDLE_ROOT;
const options={skip:!bundleRoot?'private audited Hunter bundle absent (not a pass)':false};
function fixture({count,diverse=false,conflict=false}){
 const uid='fixtureUid',code='BXH-FIXTURE01',ts=Date.parse('2026-10-22T12:00:00+08:00');
 const players=[{id:'p1',name:'Fixture A',uid},...Array.from({length:diverse?4:1},(_,i)=>({id:'p'+(i+2),name:'Opponent '+i,uid:'opponent'+i}))];
 const matches=Array.from({length:count},(_,k)=>{const opponent=diverse?'p'+(k%4+2):'p2';return {id:'match_'+(k+1),completed:true,isBye:false,a:{playerId:'p1'},b:{playerId:opponent},winnerId:conflict?'p2':'p1',loserId:opponent,scoreA:4,scoreB:0,completedAt:ts+k,log:Array.from({length:4},(_,i)=>({v:1,seq:i+1,side:'A',type:'spin',points:1,t:ts-3600000+k*10000+i*1000}))};});
 const state={id:code,meta:{name:'Hunter fixture',date:'2026-10-22',eventAuthority:'official',formatType:'single',battleMode:'individual'},players,matches,startedAt:ts-7200000,completedAt:ts+3600000};
 const documents={['tournaments/'+code+'/registrations/'+uid]:{uid,localPlayerId:'p1',status:'confirmed'},['tournaments/'+code]:{data:JSON.stringify(state),eventAuthority:'official'},['users/'+uid]:{active:true}};
 for(const p of players.slice(1))documents['users/'+p.uid]={active:true};
 const writes=[];
 const db={doc:key=>({key}),collection:key=>({key,where(){return this;},select(){return this;},limit(){return this;}}),runTransaction:async fn=>fn({get:async ref=>ref.key==='publicTournaments'?{size:1,docs:[{id:code,data:()=>({visibility:'public',eventAuthority:'official',eventDate:'2026-10-22'})}]}:{exists:Object.hasOwn(documents,ref.key),data:()=>documents[ref.key]},set:()=>writes.push('set'),create:()=>writes.push('create'),update:()=>writes.push('update'),delete:()=>writes.push('delete')})};
 return {uid,db,writes};
}
async function resolve(f){const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');return createVerifiedTierResolver({db:f.db,clock:()=>Date.parse('2026-10-23T12:00:00+08:00'),bundleRoot:path.resolve(bundleRoot)})(f.uid);}
test('35 wins against same opponent remain ungraded despite high strength',options,async()=>{const f=fixture({count:35});const result=await resolve(f);assert.equal(result.ok,true);assert.equal(result.tier,'ungraded');assert.deepEqual(f.writes,[]);});
test('two distinct verified opponents satisfy Hunter E rather than ungraded',options,async()=>{const f=fixture({count:2,diverse:true});const result=await resolve(f);assert.equal(result.ok,true);assert.equal(result.tier,'e');assert.match(result.sourceDigest,/^[a-f0-9]{64}$/);assert.deepEqual(f.writes,[]);});
test('conflicting winner and score cannot be sealed as trustworthy',options,async()=>{const f=fixture({count:1,conflict:true});const result=await resolve(f);assert.equal(result.ok,false);assert.equal(result.reason,'incomplete-server-history');assert.deepEqual(f.writes,[]);});
