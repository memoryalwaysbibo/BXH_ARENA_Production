'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../scripts/lib/hunter-prematch-rating-snapshot.cjs');

function provider(overrides={}){
  return {source:'server',verified:true,version:'hunter-rating-v1',scale:'elo-400',selfBefore:1012,opponentBefore:1120,...overrides};
}

test('trusted server provider creates immutable prematch snapshot',()=>{
  const input={capturedAt:1000,matchStartedAt:1100,provider:provider()};
  const first=c.seal(null,input);
  assert.equal(first.created,true);
  assert.equal(first.snapshot.schemaVersion,c.VERSION);
  assert.equal(first.snapshot.ratingVersion,'hunter-rating-v1');
  assert.equal(first.snapshot.ratingScale,'elo-400');
  const again=c.seal(first.snapshot,input);
  assert.equal(again.created,false);
  assert.equal(again.snapshot,first.snapshot);
});

test('snapshot must be captured strictly before match start',()=>{
  assert.throws(()=>c.buildSnapshot({capturedAt:1100,matchStartedAt:1100,provider:provider()}),/not-prematch/);
  assert.throws(()=>c.buildSnapshot({capturedAt:1200,matchStartedAt:1100,provider:provider()}),/not-prematch/);
});

test('untrusted or missing provider fails closed instead of fabricating rating',()=>{
  assert.throws(()=>c.buildSnapshot({capturedAt:1000,matchStartedAt:1100,provider:null}),/untrusted/);
  assert.throws(()=>c.buildSnapshot({capturedAt:1000,matchStartedAt:1100,provider:provider({verified:false})}),/untrusted/);
  assert.throws(()=>c.buildSnapshot({capturedAt:1000,matchStartedAt:1100,provider:provider({source:'client'})}),/untrusted/);
  assert.throws(()=>c.buildSnapshot({capturedAt:1000,matchStartedAt:1100,provider:provider({version:''})}),/version-required/);
});

test('existing snapshot cannot be mutated after sealing',()=>{
  const original=c.seal(null,{capturedAt:1000,matchStartedAt:1100,provider:provider()}).snapshot;
  assert.throws(()=>c.seal(original,{capturedAt:1000,matchStartedAt:1100,provider:provider({opponentBefore:900})}),/immutable/);
  assert.throws(()=>c.seal(original,{capturedAt:900,matchStartedAt:1100,provider:provider()}),/immutable/);
});

test('adapter projection preserves only fields accepted by Hunter B5 contract',()=>{
  const snapshot=c.buildSnapshot({capturedAt:1000,matchStartedAt:1100,provider:provider()});
  const rating=c.toHunterRatingSnapshot(snapshot);
  assert.deepEqual(rating,{
    source:'server',
    verified:true,
    version:'hunter-rating-v1',
    scale:'elo-400',
    capturedAt:1000,
    selfBefore:1012,
    opponentBefore:1120
  });
});

test('ladder cumulative points are not accepted without an explicit trusted rating provider',()=>{
  const fake={source:'server',verified:true,version:'ladder-season-points',scale:'cumulative-points',selfBefore:1800,opponentBefore:2200};
  const snapshot=c.buildSnapshot({capturedAt:1000,matchStartedAt:1100,provider:fake});
  assert.equal(snapshot.ratingScale,'cumulative-points');
  // Contract stores declared scale, but downstream calibration must choose an approved scale.
  // P2-02 intentionally does not alias ladder seasonPoints into hunter rating.
  assert.notEqual(snapshot.ratingScale,'elo-400');
});
