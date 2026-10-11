'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const d=require('../scripts/lib/hunter-model-decision-v1.cjs');

function evaluation(overrides={}){
  return {
    version:'hunter-phase2-heldout-evaluator-v1',
    split:{calibrationPlayers:70,holdoutPlayers:30},
    rows:{all:1000,calibration:700,holdout:300,coveragePct:30},
    holdout:{
      baseline:{samples:300,brier:0.22,mae:0.4,accuracy:62},
      candidate:{samples:300,brier:0.20,mae:0.37,accuracy:66},
      brierDelta:-0.02
    },
    criteria:{minHoldoutPlayers:5,minHoldoutSamples:30,maxCandidateBrierDelta:0,minCoveragePct:20},
    accepted:true,
    reasons:[],
    ...overrides
  };
}

test('PASS requires accepted evaluation with no insufficiency or model failure',()=>{
  const r=d.buildDecision({evaluation:evaluation(),modelVersion:'candidate-v0',dataVersion:'dataset-v1'});
  assert.equal(r.status,'PASS');
  assert.equal(r.productionEligible,false);
  assert.equal(r.nextAction,'manual-policy-review');
  assert.equal(r.metrics.brierDelta,-0.02);
});

test('candidate model failure becomes FAIL and keeps baseline',()=>{
  const e=evaluation({accepted:false,reasons:['candidate-brier-worse']});
  const r=d.buildDecision({evaluation:e,modelVersion:'candidate-v0',dataVersion:'dataset-v1'});
  assert.equal(r.status,'FAIL');
  assert.deepEqual(r.reasons.modelFailures,['candidate-brier-worse']);
  assert.equal(r.nextAction,'keep-baseline');
});

test('insufficient sample is not misclassified as model failure',()=>{
  const e=evaluation({accepted:false,reasons:['insufficient-holdout-players','insufficient-holdout-samples']});
  const r=d.buildDecision({evaluation:e,modelVersion:'candidate-v0',dataVersion:'dataset-v1'});
  assert.equal(r.status,'INSUFFICIENT_DATA');
  assert.equal(r.reasons.modelFailures.length,0);
  assert.equal(r.nextAction,'collect-more-data');
});

test('missing metrics is treated as insufficient data',()=>{
  const e=evaluation({
    accepted:false,
    holdout:{baseline:{samples:0,brier:null,mae:null,accuracy:null},candidate:{samples:0,brier:null,mae:null,accuracy:null},brierDelta:null},
    reasons:['missing-score-metrics']
  });
  assert.equal(d.buildDecision({evaluation:e,modelVersion:'m',dataVersion:'d'}).status,'INSUFFICIENT_DATA');
});

test('mixed insufficiency and candidate failure stays INSUFFICIENT_DATA',()=>{
  const e=evaluation({accepted:false,reasons:['insufficient-holdout-coverage','candidate-brier-worse']});
  const r=d.buildDecision({evaluation:e,modelVersion:'m',dataVersion:'d'});
  assert.equal(r.status,'INSUFFICIENT_DATA');
  assert.deepEqual(r.reasons.modelFailures,['candidate-brier-worse']);
});

test('decision carries sample, criteria, versions and input hashes but no player IDs',()=>{
  const r=d.buildDecision({
    evaluation:evaluation(),
    modelVersion:'candidate-v0',
    dataVersion:'dataset-v1',
    inputHashes:{ledgerSha256:'abc',recordsSha256:'def'}
  });
  assert.equal(r.sample.holdoutPlayers,30);
  assert.equal(r.criteria.minHoldoutSamples,30);
  assert.equal(r.inputs.ledgerSha256,'abc');
  assert.equal(JSON.stringify(r).includes('playerId'),false);
});

test('invalid evaluation or missing versions fails closed',()=>{
  assert.throws(()=>d.buildDecision({evaluation:null,modelVersion:'m',dataVersion:'d'}),/evaluation-required/);
  assert.throws(()=>d.buildDecision({evaluation:evaluation(),modelVersion:'',dataVersion:'d'}),/decision-version-required/);
});
