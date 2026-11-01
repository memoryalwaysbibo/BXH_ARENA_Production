'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const S=require('../../referee-seats/functions/scoring-core.cjs'),B=require('../../referee-seats/functions/bucket-state.cjs');
const {fixture,request}=require('./trusted-fixture.cjs');
test('local trusted scoring preserves other courts and leaves progression to structural commands',()=>{
 const f=fixture(),before=JSON.stringify(f.state.matches.slice(1)),assignments=JSON.stringify(f.state.courtAssignments);
 const d=request(f.state,f.room,'m1','score','local-operation-0001',{side:'A',finish:'extreme'});
 S.transitionLocal({...f,uid:'ref1',d,now:1000});
 assert.equal(f.state.matches[0].scoreA,3);assert.equal(f.state.matches[0].log[0].points,3);
 assert.equal(JSON.stringify(f.state.matches.slice(1)),before);assert.equal(JSON.stringify(f.state.courtAssignments),assignments);
 assert.throws(()=>S.transitionLocal({...f,uid:'ref1',d:{...d,action:'confirm'},now:1001}),/structural-command-required/);
 assert.throws(()=>S.transitionLocal({...f,uid:'ref5',d:{...d,expectedScoreRevision:1},now:1001}),/station-not-assigned/);
});
test('full match buckets reject partial epochs and restore full score ledger',()=>{
 const f=fixture(),m=f.room.scoreStorage,buckets=B.encode(f.state,m);
 const partial=B.materialize(f.state,m,[buckets[0]],'court-1');
 const d=request(partial,f.room,'m1','score','local-operation-0002',{side:'B',finish:'burst'});
 S.transitionLocal({room:f.room,state:partial,user:f.user,uid:'ref1',d,now:1000});
 const changed=B.encode(partial,m,buckets)[0];
 const complete=B.materialize(f.state,m,[changed,buckets[1]]);
 assert.equal(complete.matches[0].scoreB,2);assert.equal(complete.matches[0].log.length,1);assert.equal(changed.revision,1);
 assert.throws(()=>B.materialize(f.state,m,[{...changed,epoch:'stale'},buckets[1]]),/bucket-context/);
 assert.throws(()=>B.materialize(f.state,m,[changed]),/bucket-missing/);
});
