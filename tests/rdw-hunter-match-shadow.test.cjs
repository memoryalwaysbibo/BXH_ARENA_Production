'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessMatch}=require('../scripts/lib/rdw-hunter-match-shadow.cjs');
const evidence=(uid,tier)=>({ok:true,uid,tier,current:{tier},source:'server',verified:true,
 version:'hunter-license-v2.1',status:'unchanged',computedAt:100,
 complete:true,unresolvedIdentities:0,sourceScope:'public-official-canonical-self-history-v1',
 sourceDigest:'a'.repeat(64)});
const base=()=>({eventId:'event1',matchId:'m1',revision:1,playerA:'u1',playerB:'u2',
 evidenceA:evidence('u1','c'),evidenceB:evidence('u2','a'),capturedAt:120,matchStartedAt:121,winnerUid:'u1'});
test('Hunter-only shadow reflects current C versus A and does not mutate inputs',()=>{
 const input=base(),before=JSON.stringify(input),result=assessMatch(input);
 assert.equal(result.ok,true);assert.equal(result.mode,'hunter-rdw-shadow-only');
 assert.equal(result.comparison.eligible,2);assert.equal(result.comparison.weightedWins,1.02);
 assert.equal(result.comparison.weightedLosses,0.98);
 assert.equal(JSON.stringify(input),before);
 assert.equal('ladderPoints' in result,false);assert.equal('xp' in result,false);
 assert.equal('highestTier' in result,false);assert.equal('awards' in result,false);
});
test('ungraded Hunter is neutral in both directions',()=>{
 for(const winnerUid of ['u1','u2']){
  const input=base();input.evidenceA=evidence('u1','ungraded');input.winnerUid=winnerUid;
  const r=assessMatch(input);assert.equal(r.ok,true);
  assert.equal(r.comparison.weightedWins,1);assert.equal(r.comparison.weightedLosses,1);
 }
});
test('rejects provenance, wrong player identity, fabricated tier and incomplete history',()=>{
 const patches=[
  {source:'client'},{verified:false},{uid:'guardian'},{complete:false},
  {unresolvedIdentities:1},{sourceDigest:'bad'},{sourceScope:'ui-replay'},
  {current:{tier:'s'}},{computedAt:130},{version:'fake-v1'}
 ];
 for(const patch of patches){
  const input=base();input.evidenceA={...input.evidenceA,...patch};
  const r=assessMatch(input);assert.equal(r.ok,false,JSON.stringify(patch));
 }
});
test('rejects unknown winner, duplicate identity and invalid prematch timestamps',()=>{
 for(const patch of [{winnerUid:'other'},{playerB:'u1'},{capturedAt:121},{matchStartedAt:120},{capturedAt:0}]){
  const r=assessMatch({...base(),...patch});assert.equal(r.ok,false,JSON.stringify(patch));
 }
});
