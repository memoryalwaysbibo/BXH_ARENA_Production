'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessMatch}=require('../scripts/lib/rdw-hunter-match-shadow.cjs');
const TIERS=['ungraded','e','d','c','b','a','s','national'];
const mk=(uid,tier)=>({
 ok:true,uid,tier,current:{tier},source:'server',verified:true,
 version:'hunter-license-v2.1',status:'unchanged',computedAt:100,
 complete:true,unresolvedIdentities:0,
 sourceScope:'public-official-canonical-self-history-v1',
 sourceDigest:'a'.repeat(64),highestTier:'national',
 awards:[{id:'permanent-award',tier:'national'}],xp:999,
 ladderPoints:123456
});
function input(a,b,winnerUid='player-a'){
 return {eventId:'event',matchId:'round-1',revision:3,
  playerA:'player-a',playerB:'player-b',
  evidenceA:mk('player-a',a),evidenceB:mk('player-b',b),
  capturedAt:120,matchStartedAt:121,winnerUid};
}
test('all 64 tier pairings and both winners are correct Hunter-only observations',()=>{
 for(let i=0;i<TIERS.length;i++)for(let j=0;j<TIERS.length;j++){
  for(const winner of ['player-a','player-b']){
   const args=input(TIERS[i],TIERS[j],winner);
   const before=JSON.stringify(args);
   const out=assessMatch(args);
   assert.equal(out.ok,true,JSON.stringify({i,j,winner,out}));
   const weight=i===0||j===0?1:Number((1+(j-i)*0.01).toFixed(2));
   const winningWeight=winner==='player-a'?weight:Number((2-weight).toFixed(2));
   const losingWeight=winner==='player-a'?Number((2-weight).toFixed(2)):weight;
   assert.equal(out.comparison.weightedWins,winningWeight);
   assert.equal(out.comparison.weightedLosses,losingWeight);
   assert.equal(out.comparison.rawWins,1);
   assert.equal(out.comparison.rawLosses,1);
   assert.equal(JSON.stringify(args),before);
   for(const restricted of ['xp','ladderPoints','awards','highestTier','lifetimeGrant']){
    assert.equal(Object.hasOwn(out,restricted),false);
    assert.equal(JSON.stringify(out).includes('\"'+restricted+'\"'),false);
   }
  }
 }
});
test('highest lifetime award cannot substitute for ungraded current tier',()=>{
 const args=input('ungraded','national');
 args.evidenceA.highestTier='national';
 const out=assessMatch(args);
 assert.equal(out.ok,true);
 assert.equal(out.tiers['player-a'],'ungraded');
 assert.equal(out.comparison.weightedWins,1);
 assert.equal(out.comparison.weightedLosses,1);
});
test('missing trusted evidence fails without fabricating a score',()=>{
 for(const invalid of [null,undefined,{},'not-a-record']){
  const args=input('c','a');args.evidenceB=invalid;
  const result=assessMatch(args);
  assert.equal(result.ok,false);
  assert.equal(Object.hasOwn(result,'comparison'),false);
 }
});
