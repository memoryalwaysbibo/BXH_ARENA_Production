'use strict';
// P3-21 multi-event canonical Hunter evaluation, using the audited PRIVATE source.
// Opt-in: RDW_HUNTER_BUNDLE_ROOT=/absolute/extracted/source directory.
// CI without private source explicitly SKIPS; do not count skipped tests as success.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.RDW_HUNTER_BUNDLE_ROOT;
function fixture({count=5,conflictAt=-1}={}){
 const uid='fixtureUid',docs={'users/fixtureUid':{active:true},'users/fixtureOpponent':{active:true}},publicDocs=[];
 const ts=Date.parse('2026-10-22T12:00:00+08:00');
 for(let j=0;j<count;j++){
  const code='BXH-FIXTURE'+String(j+1).padStart(3,'0');
  publicDocs.push({id:code,data:()=>({visibility:'public',eventAuthority:'official',eventDate:'2026-10-22'})});
  const t=ts+j*100000;
  const match={id:'match_1',completed:true,isBye:false,a:{playerId:'p1'},b:{playerId:'p2'},
   winnerId:j===conflictAt?'p2':'p1',loserId:'p2',scoreA:4,scoreB:0,completedAt:t,
   log:Array.from({length:4},(_,i)=>({v:1,seq:i+1,side:'A',type:'spin',points:1,t:t-3600000+i*1000}))};
  const state={id:code,meta:{name:'Official fixture',date:'2026-10-22',eventAuthority:'official',formatType:'single',battleMode:'individual'},
   players:[{id:'p1',name:'Fixture A',uid},{id:'p2',name:'Fixture B',uid:'fixtureOpponent'}],matches:[match],
   startedAt:t-7200000,completedAt:t+3600000};
  docs['tournaments/'+code]={data:JSON.stringify(state),eventAuthority:'official'};
  docs['tournaments/'+code+'/registrations/'+uid]={uid,localPlayerId:'p1',status:'confirmed'};
 }
 const writes=[];
 const db={doc:key=>({key}),collection:key=>({key,where(){return this;},select(){return this;},limit(){return this;}}),
  runTransaction:async callback=>callback({
   get:async ref=>ref.key==='publicTournaments'?{size:publicDocs.length,docs:publicDocs}:
    ref.key==='playerEventResults'||ref.key==='ladderTransactions'?{size:0,docs:[]}:
    {exists:Object.hasOwn(docs,ref.key),data:()=>docs[ref.key]},
   set:()=>writes.push('set'),create:()=>writes.push('create'),update:()=>writes.push('update'),delete:()=>writes.push('delete')
  })};
 return {db,uid,writes};
}
const maybe={skip:!root?'requires private audited Hunter source bundle':false};
async function evaluate({count,conflictAt}){
 const {createVerifiedTierResolver}=require('../scripts/lib/rdw-verified-tier-resolver.cjs');
 const f=fixture({count,conflictAt});
 const result=await createVerifiedTierResolver({db:f.db,clock:()=>Date.parse('2026-10-23T12:00:00+08:00'),bundleRoot:path.resolve(root)})(f.uid);
 assert.deepEqual(f.writes,[],'no permanent awards or other writes');
 return result;
}
test('five official events produce stable current-tier evidence',maybe,async()=>{
 const a=await evaluate({count:5}),b=await evaluate({count:5});
 assert.equal(a.ok,true);assert.equal(a.tier,'ungraded');
 assert.match(a.sourceDigest,/^[a-f0-9]{64}$/);assert.equal(a.sourceDigest,b.sourceDigest);
});
test('one invalid score in multi-event history blocks all RDW sealing',maybe,async()=>{
 const result=await evaluate({count:5,conflictAt:3});
 assert.equal(result.ok,false);assert.equal(result.reason,'incomplete-server-history');
});
test('thirty official events stay within bounded Reader execution',maybe,async()=>{
 const result=await evaluate({count:30});assert.equal(result.ok,true);assert.match(result.sourceDigest,/^[a-f0-9]{64}$/);
});
