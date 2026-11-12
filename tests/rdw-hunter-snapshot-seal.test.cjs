'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSealer}=require('../scripts/lib/rdw-hunter-snapshot-seal.cjs');
const CODE='BXH-AB12CD',MATCH='match1';
const input={code:CODE,matchId:MATCH,actorUid:'organizer',expectedRosterRevision:5};
function evidence(uid,tier){
 return {ok:true,uid,source:'server',verified:true,complete:true,
  unresolvedIdentities:0,sourceScope:'public-official-canonical-self-history-v1',
  sourceDigest:'a'.repeat(64),version:'hunter-license-v2.1',status:'unchanged',
  computedAt:99,tier,current:{tier}};
}
function fixture(){
 const docs=new Map([['tournaments/'+CODE,{startedAt:null,rosterLocked:false}]]);
 const writes=[];
 const tx={
  get:async ref=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),
  create:(ref,value)=>{if(docs.has(ref.path))throw Error('already-exists');docs.set(ref.path,value);writes.push(ref.path);}
 };
 const db={doc:path=>({path}),runTransaction:async fn=>fn(tx)};
 const state={authorized:true,valid:true,revision:5,started:false,playerA:'a',playerB:'b',sourceValid:true};
 const service=createSealer({
  db,enabled:true,clock:()=>100,
  authorize:async()=>state.authorized,
  verifyCanonicalMatch:async()=>({valid:state.valid,rosterRevision:state.revision,
   playerA:state.playerA,playerB:state.playerB}),
  resolveTiers:async()=>({a:evidence('a','c'),
   b:state.sourceValid?evidence('b','a'):{...evidence('b','a'),source:'client'}})
 });
 return {service,docs,writes,state};
}
test('disabled snapshot reference cannot write',async()=>{
 const f=fixture();const disabled=createSealer({enabled:false});
 assert.deepEqual(await disabled(input),{ok:false,code:'rdw-snapshot-disabled'});
 assert.equal(f.writes.length,0);
});
test('server-tier snapshot seals once and remains immutable on retry',async()=>{
 const f=fixture();const first=await f.service(input);
 assert.equal(first.ok,true);assert.equal(first.created,true);
 assert.equal(f.writes.length,1);
 const stored=f.docs.get('rdwHunterShadowBaselines/'+CODE+'_'+MATCH);
 assert.equal(stored.tiers.a,'c');assert.equal(stored.tiers.b,'a');
 assert.equal(stored.affectsLadder,false);assert.equal(stored.affectsXp,false);
 assert.equal(stored.affectsAwards,false);
 const retry=await f.service(input);
 assert.equal(retry.created,false);assert.equal(f.writes.length,1);
 f.state.playerB='c';
 assert.equal((await f.service(input)).code,'immutable-baseline-conflict');
 assert.equal(f.writes.length,1);
});
test('authorization, roster and provenance failures never create a baseline',async()=>{
 for(const mutate of [
  state=>state.authorized=false,
  state=>state.valid=false,
  state=>state.revision=4,
  state=>state.playerB='a',
  state=>state.sourceValid=false
 ]){
  const f=fixture();mutate(f.state);
  assert.equal((await f.service(input)).ok,false);
  assert.equal(f.writes.length,0);
 }
});
test('missing, started and roster-locked rooms are always blocked',async()=>{
 for(const room of [null,{startedAt:123,rosterLocked:false},{startedAt:null,rosterLocked:true}]){
  const f=fixture();
  if(room===null)f.docs.delete('tournaments/'+CODE);
  else f.docs.set('tournaments/'+CODE,room);
  assert.equal((await f.service(input)).ok,false);assert.deepEqual(f.writes,[]);
 }
});
test('ungraded stays an explicit trusted tier, not a missing identity',async()=>{
 const f=fixture();
 const service=createSealer({enabled:true,db:{
  doc:path=>({path}),runTransaction:async fn=>fn({
   get:async ref=>({exists:ref.path==='tournaments/'+CODE,data:()=>({startedAt:null,rosterLocked:false})}),
   create:(_ref,snapshot)=>{assert.equal(snapshot.tiers.a,'ungraded');assert.equal(snapshot.rdwOnly,true);}
  })
 },clock:()=>100,authorize:async()=>true,verifyCanonicalMatch:async()=>({
  valid:true,rosterRevision:5,playerA:'a',playerB:'b'}),
 resolveTiers:async()=>({a:evidence('a','ungraded'),b:evidence('b','a')})});
 assert.equal((await service(input)).ok,true);
 assert.deepEqual(f.writes,[]);
});
