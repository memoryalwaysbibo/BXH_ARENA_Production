const test=require('node:test'),assert=require('node:assert/strict');
const RDW=require('../modules/main-app/rdw-shadow-v1.js');
const {evaluate}=require('../scripts/lib/rdw-shadow-comparison.cjs');
// Fictional ranks only. DO NOT commit real user UIDs or data from BXH-SDSAQZ.
const ungraded='ungraded',d='d';
function sample(selfTier,opponentTier){return {source:'server',verified:true,capturedAt:1000,matchStartedAt:2000,selfTierBefore:selfTier,opponentTierBefore:opponentTier};}
test('ungraded vs D: formula is +2/-2%, but protected official shadow mode stays neutral',()=>{
 assert.equal(RDW.weight(ungraded,d),1.02);
 assert.equal(RDW.weight(d,ungraded),0.98);
 assert.equal(RDW.protectedWeight(ungraded,d),1);
 assert.equal(RDW.protectedWeight(d,ungraded),1);
 assert.equal(RDW.verifiedPreMatchWeight(sample(ungraded,d)),1);
 assert.equal(RDW.verifiedPreMatchWeight(sample(d,ungraded)),1);
 const result=evaluate([{snapshot:sample(ungraded,d),isWin:true},{snapshot:sample(d,ungraded),isWin:false}]);
 assert.equal(result.eligible,2);assert.equal(result.neutral,2);
 assert.equal(result.weightedWins,1);assert.equal(result.weightedLosses,1);
});
test('invalid player tier never bypasses verification via ungraded neutral exception',()=>{
 for(const bogus of [undefined,null,'','fake','NATIONAL','unranked',{}]){
  assert.equal(RDW.protectedWeight('ungraded',bogus),null);
  assert.equal(RDW.protectedWeight(bogus,'ungraded'),null);
  assert.equal(RDW.verifiedPreMatchWeight(sample('ungraded',bogus)),null);
 }
});
test('a verified D-versus-C pair remains weighted within current protected mode',()=>{
 assert.equal(RDW.verifiedPreMatchWeight(sample('d','c')),1.01);
 assert.equal(RDW.verifiedPreMatchWeight(sample('c','d')),0.99);
});
