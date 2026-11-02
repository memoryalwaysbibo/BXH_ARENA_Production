'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../../modules/scoring/four-court-buckets.cjs');
test('auto allocation covers 1 through 21 courts without configured bucket count',()=>{
 for(const [courts,buckets] of [[1,1],[4,1],[5,2],[6,2],[8,2],[9,3],[12,3],[16,4],[20,5],[21,6]]){
  const m=B.manifest('BXH-LAB1','room',courts);
  assert.equal(m.bucketCount,buckets);
  for(let i=1;i<=courts;i++)assert.equal(B.route(m,i).id,'court-'+Math.ceil(i/4));
 }
 assert.throws(()=>B.bucketForCourt(0),/invalid-station/);
 assert.throws(()=>B.route(B.manifest('BXH-LAB1','room',6),7),/invalid-route/);
 assert.throws(()=>B.route({...B.manifest('BXH-LAB1','room',6),bucketCount:1},5),/invalid-route/);
});
test('same bucket has per-match revision and rejects stale scores without touching other matches',()=>{
 const m=B.manifest('BXH-LAB1','room',6),b=B.initialBucket(m,B.route(m,1),[{id:'m1',station:1},{id:'m2',station:2},{id:'m5',station:5}]);
 const result=B.applyScore(b,{bucketId:'court-1',matchId:'m1',station:1,expectedRevision:0,side:'A',points:1,operationId:'test-operation-0001'});
 assert.equal(b.matches.m1.scoreA,0);assert.equal(result.bucket.matches.m2.scoreA,0);assert.equal(result.bucket.matches.m1.scoreA,1);
 assert.throws(()=>B.applyScore(result.bucket,{bucketId:'court-1',matchId:'m1',station:1,expectedRevision:0,side:'A',points:1}),/score-stale/);
 assert.throws(()=>B.applyScore(result.bucket,{bucketId:'court-2',matchId:'m1',station:1,expectedRevision:1,side:'A',points:1}),/bucket-mismatch/);
 assert.throws(()=>B.applyScore({...b,matches:{m1:{...b.matches.m1,scoreA:-1}}},{bucketId:'court-1',matchId:'m1',station:1,expectedRevision:0,side:'A',points:1,operationId:'test-operation-0001'}),/bucket-corrupt/);
});
test('projection requires complete room-bound bucket set and never mutates base',()=>{
 const m=B.manifest('BXH-LAB1','room',6),base={id:'room',cloudCode:m.code,matches:Array.from({length:6},(_,i)=>({id:'m'+(i+1),station:i+1,scoreA:0,scoreB:0}))};
 const buckets=[0,1].map(index=>B.initialBucket(m,B.bucketForCourt(index*4+1),base.matches));
 buckets[1]=B.applyScore(buckets[1],{bucketId:'court-2',matchId:'m5',station:5,expectedRevision:0,side:'B',points:2,operationId:'test-operation-0005'}).bucket;
 assert.equal(B.compose(base,m,buckets).matches[4].scoreB,2);assert.equal(base.matches[4].scoreB,0);
 assert.throws(()=>B.compose(base,m,buckets.slice(0,1)),/projection-context/);
 assert.throws(()=>B.compose(base,m,[buckets[0],{...buckets[1],roomId:'other'}]),/projection-bucket/);
 assert.throws(()=>B.compose(base,m,[{...buckets[0],matches:{...buckets[0].matches,m1:{...buckets[0].matches.m1,scoreA:-2}}},buckets[1]]),/projection-corrupt/);
});
