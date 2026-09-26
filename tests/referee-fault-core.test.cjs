'use strict';
const assert=require('node:assert/strict');
const F=require('../referee-fault-core.js');

function match(){
  return {id:'m1',status:'in_progress',completed:false,scoreA:0,scoreB:0,log:[],faultActions:[]};
}

{
  const m=match();
  let r=F.applyFault(m,'A',100);
  assert.equal(r.ok,true);
  assert.equal(r.scored,false);
  assert.equal(F.count(m,'A'),1);
  assert.equal(F.count(m,'B'),0);
  assert.equal(m.scoreA,0);
  assert.equal(m.scoreB,0);

  r=F.applyFault(m,'B',110);
  assert.equal(r.scored,false);
  assert.equal(F.count(m,'A'),1);
  assert.equal(F.count(m,'B'),1);

  r=F.applyFault(m,'A',120);
  assert.equal(r.scored,true);
  assert.equal(r.recipientSide,'B');
  assert.equal(m.scoreB,1);
  assert.equal(m.log.length,1);
  assert.equal(m.log[0].type,'fault');
  assert.equal(m.log[0].side,'B');
  assert.equal(m.log[0].faultSide,'A');
  assert.deepEqual(m.log[0].faultActionsBefore,[{side:'A',at:100},{side:'B',at:110}]);
  assert.equal(F.hasPending(m),false);

  const event=m.log.pop();
  m.scoreB-=event.points;
  F.restoreFromEvent(m,event);
  assert.equal(m.scoreB,0);
  assert.equal(F.count(m,'A'),1);
  assert.equal(F.count(m,'B'),1);
}

{
  const m=match();
  F.applyFault(m,'A',100);
  F.applyFault(m,'B',110);
  const last=F.popPending(m);
  assert.deepEqual(last,{side:'B',at:110});
  assert.equal(F.count(m,'A'),1);
  assert.equal(F.count(m,'B'),0);
  F.popPending(m);
  assert.equal(F.hasPending(m),false);
}

{
  const m=match();
  F.applyFault(m,'A',100);
  const scoreEvent={type:'spin',side:'B',points:1};
  F.attachSnapshotToEvent(m,scoreEvent);
  F.clear(m);
  assert.equal(F.hasPending(m),false);
  F.restoreFromEvent(m,scoreEvent);
  assert.equal(F.count(m,'A'),1);
}

{
  const m=match();
  m.scoreB=6;
  F.applyFault(m,'A',100);
  const r=F.applyFault(m,'A',110);
  assert.equal(r.ok,false);
  assert.equal(r.reason,'invalid-score');
  assert.equal(m.scoreB,6);
}

console.log('PASS referee two-fault core');
