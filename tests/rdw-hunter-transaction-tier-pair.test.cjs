'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTransactionTierResolver}=require('../scripts/lib/rdw-hunter-transaction-tier-pair.cjs');
const {createSealer}=require('../scripts/lib/rdw-hunter-snapshot-seal.cjs');
const CODE='BXH-ABC123';
function buildFixture(){
 const docs=new Map([
  ['tournaments/'+CODE,{registrationRosterRevision:4,startedAt:null,rosterLocked:false}],
  ['users/a',{active:true}],['users/b',{active:true}]
 ]);
 const writes=[];
 const db={doc:p=>({path:p}),collection:p=>({path:p}),
  runTransaction:async fn=>fn({
   get:async ref=>({exists:docs.has(ref.path),data:()=>docs.get(ref.path)}),
   create:(ref,value)=>{docs.set(ref.path,value);writes.push(ref.path);}
  })};
 let readerCalls=0;
 const createReader=({db:readerDb})=>{
  for(const k of ['runTransaction','batch','bulkWriter'])assert.equal(k in readerDb,false);
  return async({tx,uid})=>{
   readerCalls++;
   assert.equal('create' in tx,false);assert.equal('set' in tx,false);
   const snap=await tx.get(readerDb.doc('users/'+uid));
   if(!snap.exists)return null;
   return {uid,version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,
    sourceScope:'public-official-canonical-self-history-v1',
    sourceDigest:'a'.repeat(64),overview:{grade:{tier:uid==='a'?'ungraded':'a'}}};
  };
 };
 const resolver=createTransactionTierResolver({db,createReader});
 const sealer=createSealer({db,resolveTiers:resolver,enabled:true,clock:()=>100,
  authorize:async()=>true,verifyCanonicalMatch:async()=>({valid:true,rosterRevision:4,playerA:'a',playerB:'b'})});
 return {docs,writes,sealer,resolver,get readerCalls(){return readerCalls}};
}
test('real contract adapter seals neutral ungraded and A within ONE transaction',async()=>{
 const f=buildFixture();
 const input={code:CODE,matchId:'match1',actorUid:'host',expectedRosterRevision:4};
 const result=await f.sealer(input);
 assert.equal(result.ok,true);assert.equal(result.created,true);
 assert.equal(f.readerCalls,2);
 assert.deepEqual(f.writes,['rdwHunterShadowBaselines/'+CODE+'_match1']);
 const baseline=f.docs.get(f.writes[0]);
 assert.deepEqual(baseline.tiers,{a:'ungraded',b:'a'});
 assert.equal(baseline.affectsLadder,false);assert.equal(baseline.affectsXp,false);assert.equal(baseline.affectsAwards,false);
 assert.equal((await f.sealer(input)).created,false);
 assert.equal(f.readerCalls,2);
});
test('missing second player fails closed with zero snapshot writes',async()=>{
 const f=buildFixture();f.docs.delete('users/b');
 const result=await f.sealer({code:CODE,matchId:'missing',actorUid:'host',expectedRosterRevision:4});
 assert.equal(result.code,'hunter-history-unverified');
 assert.deepEqual(f.writes,[]);
});
test('untrusted writable transaction is rejected by the injected reader',async()=>{
 const f=buildFixture();
 await assert.rejects(f.resolver({tx:{get:async()=>({exists:true,data:()=>({active:true})})},
  playerA:'a',playerB:'b',atMs:100}),/trusted-pair-context-required/);
});
test('guard rejects duplicated and invalid competitor UIDs before tier read',async()=>{
 const f=buildFixture();
 for(const playerB of ['a','guardian/child','']){
  await assert.rejects(f.resolver({tx:Object.freeze({get:async()=>null}),
   playerA:'a',playerB,atMs:100}),/trusted-pair-context-required/);
 }
 assert.equal(f.readerCalls,0);
});
