'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const candidate=require('../scripts/candidates/hunter-strength-opponent-v0.cjs');

function item({win=true,self=1000,opponent=1000,scoreFor=4,scoreAgainst=1}={}){
  return {record:{isWin:win,scoreFor,scoreAgainst},rating:{self,opponent,version:'fixture'}};
}

test('stronger opponents raise the candidate for identical results',()=>{
  const strong=Array.from({length:10},()=>item({opponent:1200}));
  const even=Array.from({length:10},()=>item({opponent:1000}));
  const weak=Array.from({length:10},()=>item({opponent:800}));
  const a=candidate.evaluate(strong),b=candidate.evaluate(even),c=candidate.evaluate(weak);
  assert.ok(a>b);
  assert.ok(b>c);
});

test('small samples are pulled toward neutral more than mature samples',()=>{
  const small=Array.from({length:3},()=>item());
  const large=Array.from({length:40},()=>item());
  assert.ok(candidate.evaluate(small)<candidate.evaluate(large));
  assert.ok(candidate.evaluate(small)>50);
});

test('upsets are rewarded and expected losses are penalized less than weak-opponent losses',()=>{
  const upset=[item({win:true,opponent:1300}),item({win:true,opponent:1300}),item({win:false,opponent:1300,scoreFor:1,scoreAgainst:4})];
  const weakLoss=[item({win:true,opponent:700}),item({win:true,opponent:700}),item({win:false,opponent:700,scoreFor:1,scoreAgainst:4})];
  assert.ok(candidate.evaluate(upset)>candidate.evaluate(weakLoss));
});

test('score is finite, bounded and deterministic',()=>{
  const rows=Array.from({length:100},(_,i)=>item({win:i%3!==0,opponent:700+(i%7)*100,scoreFor:i%3!==0?4:1,scoreAgainst:i%3!==0?1:4}));
  const a=candidate.evaluate(rows),b=candidate.evaluate(JSON.parse(JSON.stringify(rows)));
  assert.equal(a,b);
  assert.ok(Number.isFinite(a));
  assert.ok(a>=0&&a<=100);
});

test('invalid candidate input fails closed',()=>{
  assert.throws(()=>candidate.evaluate([]),/prefix-empty/);
  assert.throws(()=>candidate.evaluate([{record:{isWin:true,scoreFor:4,scoreAgainst:1},rating:null}]),/rating-invalid/);
});
