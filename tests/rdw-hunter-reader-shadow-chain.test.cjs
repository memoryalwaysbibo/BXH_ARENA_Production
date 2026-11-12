'use strict';
// Isolated in-memory integration: NOT a Firebase Emulator or production test.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReadOnlyTierResolver}=require('../scripts/lib/rdw-hunter-readonly-bridge.cjs');
const {assessMatch}=require('../scripts/lib/rdw-hunter-match-shadow.cjs');
function fixture(){
 const users=new Map([
  ['a',{active:true}],['b',{active:true}]
 ]);
 const history=new Map([['a','c'],['b','a']]);
 const lifetime=new Map([
  ['a',{highestTier:'s',xp:450,awardIds:['original-a'],ladderPoints:123}],
  ['b',{highestTier:'national',xp:970,awardIds:['original-b'],ladderPoints:987}]
 ]);
 const before=JSON.stringify([...lifetime.entries()]);
 const writes=[];
 const db={
  doc:(path)=>({path}),
  collection:(name)=>({name}),
  runTransaction:async(callback)=>{
   const tx={
    get:async(ref)=>{
     const [scope,uid]=ref.path.split('/');
     const value=scope==='users'?users.get(uid):scope==='licenseHistory'?history.get(uid):scope==='lifetime'?lifetime.get(uid):undefined;
     return {exists:value!==undefined,data:()=>value};
    },
    set:()=>writes.push('set'),create:()=>writes.push('create'),
    update:()=>writes.push('update'),delete:()=>writes.push('delete')
   };
   return callback(tx);
  }
 };
 const createReader=()=>async({tx,uid})=>{
  // Only the read capability is exposed to the licensed reader.
  for(const method of ['set','create','update','delete'])assert.equal(typeof tx[method],'undefined');
  const record=await tx.get(db.doc('licenseHistory/'+uid));
  const current=record.data();
  return {uid,version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,
   sourceScope:'public-official-canonical-self-history-v1',
   sourceDigest:'a'.repeat(64),overview:{grade:{tier:current}}};
 };
 return {db,createReader,users,history,lifetime,writes,before};
}
test('trusted Hunter reader → prematch shadow leaves lifetime awards, XP and ladder unchanged',async()=>{
 const f=fixture();
 const resolve=createReadOnlyTierResolver({db:f.db,createReader:f.createReader,clock:()=>100});
 const [evidenceA,evidenceB]=await Promise.all([resolve('a'),resolve('b')]);
 assert.equal(evidenceA.ok,true);assert.equal(evidenceB.ok,true);
 const result=assessMatch({
  eventId:'event-1',matchId:'match-1',revision:2,
  playerA:'a',playerB:'b',evidenceA,evidenceB,capturedAt:110,
  matchStartedAt:111,winnerUid:'a'
 });
 assert.equal(result.ok,true);
 assert.equal(result.tiers.a,'c');assert.equal(result.tiers.b,'a');
 assert.equal(result.comparison.weightedWins,1.02);
 assert.equal(result.comparison.weightedLosses,0.98);
 assert.deepEqual(f.writes,[]);
 assert.equal(JSON.stringify([...f.lifetime.entries()]),f.before);
});
test('ungraded current tier stays neutral despite higher permanent award',async()=>{
 const f=fixture();f.history.set('a','ungraded');
 const resolve=createReadOnlyTierResolver({db:f.db,createReader:f.createReader,clock:()=>100});
 const result=assessMatch({
  eventId:'event-2',matchId:'match-1',playerA:'a',playerB:'b',
  evidenceA:await resolve('a'),evidenceB:await resolve('b'),
  capturedAt:110,matchStartedAt:111,winnerUid:'a'
 });
 assert.equal(result.ok,true);
 assert.equal(result.comparison.weightedWins,1);
 assert.equal(result.comparison.weightedLosses,1);
 assert.equal(f.lifetime.get('a').highestTier,'s');
 assert.deepEqual(f.writes,[]);
});
test('invalid guardian and incomplete reader history prevent shadow calculation',async()=>{
 const f=fixture();f.users.delete('a');
 const resolve=createReadOnlyTierResolver({db:f.db,createReader:f.createReader,clock:()=>100});
 const evidenceA=await resolve('a');
 const evidenceB=await resolve('b');
 assert.equal(evidenceA.ok,false);
 const result=assessMatch({
  eventId:'event-3',matchId:'match-1',playerA:'a',playerB:'b',
  evidenceA,evidenceB,capturedAt:110,matchStartedAt:111,winnerUid:'a'
 });
 assert.equal(result.ok,false);
 assert.equal(Object.hasOwn(result,'comparison'),false);
 assert.deepEqual(f.writes,[]);
 assert.equal(JSON.stringify([...f.lifetime.entries()]),f.before);
});
