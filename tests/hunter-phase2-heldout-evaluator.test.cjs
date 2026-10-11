'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const e=require('../scripts/lib/hunter-heldout-evaluator-v1.cjs');

function series(players=20,matches=8,{candidateBetter=true}={}){
  const out={};
  for(let p=0;p<players;p++){
    const id='player-'+p,rows=[];
    for(let i=0;i<matches;i++){
      const win=(i+p)%3!==0;
      rows.push({
        completedAt:1000+i,
        isWin:win,
        baselineScoreBefore:win?65:55,
        candidateScoreBefore:candidateBetter?(win?80:20):(win?60:60)
      });
    }
    out[id]=rows;
  }
  return out;
}

test('player split is deterministic and disjoint',()=>{
  const ids=Array.from({length:100},(_,i)=>'p'+i);
  const a=e.splitPlayers(ids),b=e.splitPlayers(ids.slice().reverse());
  assert.deepEqual(a,b);
  assert.equal(a.calibration.some(x=>a.holdout.includes(x)),false);
  assert.equal(a.calibration.length+a.holdout.length,100);
  assert.ok(a.calibration.length>0);
  assert.ok(a.holdout.length>0);
});

test('prediction rows skip warmup matches and require precomputed before-scores',()=>{
  const rows=e.buildPredictionRows({
    a:[
      {completedAt:1,isWin:true,baselineScoreBefore:1,candidateScoreBefore:1},
      {completedAt:2,isWin:true,baselineScoreBefore:1,candidateScoreBefore:1},
      {completedAt:3,isWin:true,baselineScoreBefore:1,candidateScoreBefore:1},
      {completedAt:4,isWin:false,baselineScoreBefore:60,candidateScoreBefore:30}
    ]
  },{warmupMatches:3});
  assert.equal(rows.length,1);
  assert.equal(rows[0].completedAt,4);
});

test('candidate with better holdout outcomes is accepted when sample thresholds are met',()=>{
  const r=e.evaluate(series(40,10),{minHoldoutPlayers:3,minHoldoutSamples:10,minCoveragePct:10});
  assert.equal(r.accepted,true,r.reasons.join(','));
  assert.ok(r.holdout.candidate.brier<r.holdout.baseline.brier);
  assert.ok(r.holdout.candidate.accuracy>=r.holdout.baseline.accuracy);
});

test('worse candidate is rejected without touching calibration rows',()=>{
  const r=e.evaluate(series(40,10,{candidateBetter:false}),{minHoldoutPlayers:3,minHoldoutSamples:10,minCoveragePct:10,maxCandidateBrierDelta:0});
  assert.equal(r.accepted,false);
  assert.ok(r.reasons.includes('candidate-brier-worse'));
});

test('small datasets fail closed on holdout sufficiency',()=>{
  const r=e.evaluate(series(3,5),{minHoldoutPlayers:5,minHoldoutSamples:30});
  assert.equal(r.accepted,false);
  assert.ok(r.reasons.some(x=>x.startsWith('insufficient-holdout')));
});

test('holdout player identities never overlap calibration identities',()=>{
  const r=e.evaluate(series(60,8),{minHoldoutPlayers:1,minHoldoutSamples:1,minCoveragePct:1});
  const c=new Set(r.split.calibrationPlayerIds);
  assert.equal(r.split.holdoutPlayerIds.some(x=>c.has(x)),false);
});

test('score mapping is bounded and invalid values are excluded',()=>{
  assert.equal(e.scoreToProxyProbability(0),0);
  assert.equal(e.scoreToProxyProbability(100),1);
  assert.equal(e.scoreToProxyProbability(-1),null);
  assert.equal(e.scoreToProxyProbability(101),null);
});
