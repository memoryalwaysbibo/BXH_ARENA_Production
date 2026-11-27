'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compose,baselineHash}=require('./release/compose-rules.cjs');
test('V3 rules composer requires exact read-only reviewed live source',()=>{
 assert.match(baselineHash,/^[a-f0-9]{64}$/);
 assert.throws(()=>compose('unreviewed'),/Unreviewed Firestore Rules baseline/);
});
