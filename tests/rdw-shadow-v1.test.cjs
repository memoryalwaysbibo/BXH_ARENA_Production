const test=require('node:test');
const assert=require('node:assert/strict');
const RDW=require('../modules/main-app/rdw-shadow-v1.js');
const tiers=RDW.tiers;
test('RDW eight tiers: each ordered pair is 1% per rank gap',()=>{
  assert.equal(tiers.length,8);
  for(let self=0;self<8;self++)for(let opponent=0;opponent<8;opponent++){
    assert.equal(RDW.weight(tiers[self],tiers[opponent]),Number((1+(opponent-self)*0.01).toFixed(2)));
  }
});
test('RDW boundaries, same rank, symmetry and unknown rank',()=>{
  assert.equal(RDW.weight('national','ungraded'),0.93);
  assert.equal(RDW.weight('ungraded','national'),1.07);
  assert.equal(RDW.weight('c','c'),1);
  assert.equal(RDW.weight('c','a'),1.02);
  assert.equal(RDW.weight('c','e'),0.98);
  assert.equal(RDW.weight('bogus','c'),null);
  assert.equal(RDW.weight(null,'c'),null);
  for(const a of tiers)for(const b of tiers)assert.ok(Math.abs(RDW.weight(a,b)+RDW.weight(b,a)-2)<1e-10);
});
test('only verified server snapshots captured before start can be weighted',()=>{
  const s={source:'server',verified:true,capturedAt:100,matchStartedAt:200,selfTierBefore:'c',opponentTierBefore:'b'};
  assert.equal(RDW.verifiedPreMatchWeight(s),1.01);
  for(const patch of [{source:'client'},{verified:false},{capturedAt:200},{capturedAt:201},{capturedAt:0},{matchStartedAt:NaN},{selfTierBefore:'unknown'},{opponentTierBefore:null}])
    assert.equal(RDW.verifiedPreMatchWeight({...s,...patch}),null);
  assert.equal(RDW.verifiedPreMatchWeight(null),null);
});
