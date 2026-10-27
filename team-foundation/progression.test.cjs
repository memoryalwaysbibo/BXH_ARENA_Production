'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {progression,teamStrength} = require('./progression.cjs');
test('experience thresholds and capacities including final two places',()=>{
  assert.deepEqual(progression(0),{level:1,capacity:10,unlockedFrames:[],currentXp:0,nextXp:3,totalXp:0});
  assert.equal(progression(2).level,1); assert.equal(progression(3).capacity,11);
  assert.deepEqual(progression(12).unlockedFrames,[4]);
  assert.deepEqual(progression(33).unlockedFrames,[4,7]);
  assert.equal(progression(62).capacity,18);
  assert.deepEqual(progression(63),{level:10,capacity:20,unlockedFrames:[4,7,10],currentXp:null,nextXp:null,totalXp:63});
  assert.equal(progression(100).level,10);
});
test('reject invalid experience and sum only supplied current scores',()=>{
 for (const n of [-1, 1.5, NaN, Infinity]) assert.throws(()=>progression(n));
 assert.equal(teamStrength([100,200,50]),350); assert.equal(teamStrength([100,50]),150);
 assert.throws(()=>teamStrength([NaN]));
});
