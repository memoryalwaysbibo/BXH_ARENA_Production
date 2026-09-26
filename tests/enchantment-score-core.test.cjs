const test=require('node:test');
const assert=require('node:assert/strict');
const {BASE,CARDS,resolve}=require('../enchantment-score-core.js');

test('12 cards and four base outcomes remain distinct',()=>{
  assert.equal(Object.keys(CARDS).length,12);
  assert.deepEqual(BASE,{spin:1,knockout:2,burst:2,extreme:3});
});
test('double burst adds two and boosted burst adds one',()=>{
  assert.deepEqual(resolve({type:'burst',winnerCardId:'double_burst',loserCardId:'weaken_spin'}).points,4);
  assert.equal(resolve({type:'burst',winnerCardId:'boost_burst',loserCardId:'weaken_spin'}).points,3);
});
test('defense may reduce a spin finish to zero without a second scoring event',()=>{
  const r=resolve({type:'spin',winnerCardId:'boost_burst',loserCardId:'weaken_spin'});
  assert.equal(r.points,0);assert.equal(r.delta,-1);assert.equal(r.appliedCardId,'weaken_spin');
});
test('seal cancels only the opponent card, including two seals',()=>{
  assert.equal(resolve({type:'burst',winnerCardId:'double_burst',loserCardId:'seal'}).points,2);
  assert.equal(resolve({type:'burst',winnerCardId:'seal',loserCardId:'weaken_burst'}).points,2);
  assert.equal(resolve({type:'burst',winnerCardId:'seal',loserCardId:'seal'}).points,2);
});
test('defense takes priority when both cards match the winning outcome',()=>{
  const r=resolve({type:'burst',winnerCardId:'double_burst',loserCardId:'weaken_burst'});
  assert.equal(r.ok,true);assert.equal(r.points,1);assert.equal(r.delta,-1);
  assert.equal(r.appliedCardId,'weaken_burst');
});
test('invalid or absent draw cannot produce a score',()=>{
  assert.equal(resolve({type:'burst',winnerCardId:'double_burst'}).ok,false);
  assert.equal(resolve({type:'fault',winnerCardId:'seal',loserCardId:'seal'}).ok,false);
});
