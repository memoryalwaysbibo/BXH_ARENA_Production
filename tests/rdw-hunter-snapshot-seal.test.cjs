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
 const docs=new Map([['tournaments/'+CODE,{startedAt:null,rosterLocked:false,registrationRosterRevision:5}]]);
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
 for(const room of [null,{startedAt:123,rosterLocked:false,registrationRosterRevision:5},{startedAt:null,rosterLocked:true,registrationRosterRevision:5}]){
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
   get:async ref=>({exists:ref.path==='tournaments/'+CODE,data:()=>({startedAt:null,rosterLocked:false,registrationRosterRevision:5})}),
   create:(_ref,snapshot)=>{assert.equal(snapshot.tiers.a,'ungraded');assert.equal(snapshot.rdwOnly,true);}
  })
 },clock:()=>100,authorize:async()=>true,verifyCanonicalMatch:async()=>({
  valid:true,rosterRevision:5,playerA:'a',playerB:'b'}),
 resolveTiers:async()=>({a:evidence('a','ungraded'),b:evidence('b','a')})});
 assert.equal((await service(input)).ok,true);
 assert.deepEqual(f.writes,[]);
});

test('nested canonical state blocks late seal even when root claims pre-start',async()=>{
 const f=fixture();
 f.docs.set('tournaments/'+CODE,{
  startedAt:null,rosterLocked:false,registrationRosterRevision:5,
  data:JSON.stringify({startedAt:123,rosterLocked:true,registrationRosterRevision:5})
 });
 const result=await f.service(input);
 assert.equal(result.ok,false);assert.equal(result.code,'tournament-already-started');
 assert.deepEqual(f.writes,[]);
});
test('missing, stale or malformed canonical roster revision fails closed',async()=>{
 for(const room of [
  {startedAt:null,rosterLocked:false},
  {startedAt:null,rosterLocked:false,registrationRosterRevision:4},
  {registrationRosterRevision:5,data:'not-json'},
  {registrationRosterRevision:5,data:JSON.stringify({startedAt:null,rosterLocked:false,registrationRosterRevision:4})},
  {registrationRosterRevision:5,data:JSON.stringify({startedAt:null,rosterLocked:false})}
 ]){
  const f=fixture();f.docs.set('tournaments/'+CODE,room);
  assert.equal((await f.service(input)).ok,false,JSON.stringify(room));
  assert.deepEqual(f.writes,[]);
 }
});
test('preexisting baseline with missing trusted proof is never accepted as idempotent',async()=>{
 const f=fixture();
 f.docs.set('rdwHunterShadowBaselines/'+CODE+'_'+MATCH,{
  code:CODE,matchId:MATCH,playerA:'a',playerB:'b',rosterRevision:5
 });
 assert.equal((await f.service(input)).code,'immutable-baseline-conflict');
 assert.deepEqual(f.writes,[]);
});

test('canonical JSON state may seal only when its own revision and pre-start gates agree',async()=>{
 const f=fixture();
 f.docs.set('tournaments/'+CODE,{
  registrationRosterRevision:5,
  data:JSON.stringify({registrationRosterRevision:5,startedAt:null,rosterLocked:false,meta:{battleMode:'individual'}})
 });
 const result=await f.service(input);
 assert.equal(result.ok,true);assert.equal(result.created,true);
 assert.equal(f.writes.length,1);
});
test('team battle canonical state is outside the RDW snapshot rollout',async()=>{
 const f=fixture();
 f.docs.set('tournaments/'+CODE,{
  registrationRosterRevision:5,
  data:JSON.stringify({registrationRosterRevision:5,meta:{battleMode:'team'}})
 });
 const result=await f.service(input);
 assert.equal(result.ok,false);assert.equal(result.code,'team-mode-not-audited');
 assert.deepEqual(f.writes,[]);
});

test('tier resolver gets only transaction read access',async()=>{
 const f=fixture();
 const service=createSealer({
  enabled:true,
  db:{doc:path=>({path}),runTransaction:async fn=>fn({
   get:async ref=>({exists:ref.path==='tournaments/'+CODE,data:()=>({registrationRosterRevision:5})}),
   create:()=>{}
  })},
  clock:()=>100,authorize:async()=>true,
  verifyCanonicalMatch:async()=>({valid:true,rosterRevision:5,playerA:'a',playerB:'b'}),
  resolveTiers:async({tx})=>{
   assert.equal(typeof tx.get,'function');
   assert.equal(Object.isFrozen(tx),true);
   for(const op of ['create','set','update','delete'])assert.equal(op in tx,false);
   return {a:evidence('a','c'),b:evidence('b','a')};
  }
 });
 assert.equal((await service(input)).ok,true);
 assert.equal(f.writes.length,0);
});
test('incomplete previously sealed evidence cannot be accepted on retry',async()=>{
 for(const patch of [
  {capturedAtMs:undefined},
  {tiers:{a:'invalid',b:'a'}},
  {digests:{a:'not-a-digest',b:'a'.repeat(64)}}
 ]){
  const f=fixture();
  assert.equal((await f.service(input)).ok,true);
  const key='rdwHunterShadowBaselines/'+CODE+'_'+MATCH;
  f.docs.set(key,{...f.docs.get(key),...patch});
  assert.equal((await f.service(input)).code,'immutable-baseline-conflict');
  assert.equal(f.writes.length,1);
 }
});
