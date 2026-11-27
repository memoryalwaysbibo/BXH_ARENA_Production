'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyHold,summary}=require('./hold-core.cjs');
const initial=capacity=>({capacity,occupiedCount:0,pendingReviewCount:0,confirmedCount:0,sequence:0,revision:0});
const join=(ledger,uid,previous)=>applyHold(ledger,previous,{action:'join',uid,operationId:'join-'+uid,now:1});
test('192 holds allocate sequentially without profile data or overbooking',()=>{
 let ledger=initial(192);
 const holds=[];
 for(let i=0;i<192;i++){
  const x=join(ledger,'player'+i);
  ledger=x.ledger;holds.push(x.hold);
  assert.deepEqual(Object.keys(x.hold).sort(),['attemptId','sequence','status','submittedAt','uid','updatedAt']);
  assert.equal(x.hold.sequence,i+1);
 }
 assert.equal(summary(ledger).availableCount,0);
 assert.throws(()=>join(ledger,'extra'),/full/);
 assert.throws(()=>join(ledger,'player0',holds[0]),/already-registered/);
});
test('approve preserves occupancy, rejection releases one and stale review fails',()=>{
 const a=join(initial(2),'a'),b=join(a.ledger,'b');
 const approved=applyHold(b.ledger,a.hold,{action:'approve',expectedAttemptId:a.hold.attemptId,now:2});
 assert.equal(approved.ledger.occupiedCount,2);
 const rejected=applyHold(approved.ledger,b.hold,{action:'reject',expectedAttemptId:b.hold.attemptId,now:3});
 assert.equal(summary(rejected.ledger).availableCount,1);
 assert.throws(()=>applyHold(rejected.ledger,b.hold,{action:'approve',expectedAttemptId:'old',now:4}),/registration-attempt-changed/);
});
