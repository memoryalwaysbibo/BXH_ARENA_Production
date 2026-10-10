'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const l=require('../scripts/lib/hunter-rating-ledger-v0.cjs');
const p=require('../scripts/lib/hunter-rating-provider-v0.cjs');

function row(overrides={}){
  return {
    version:l.VERSION,
    source:l.SOURCE,
    scoringVersion:'bxh-4pt-v1',
    eventCode:'BXH-E1',
    matchId:'m1',
    revision:1,
    status:'completed',
    updatedAt:110,
    completedAt:100,
    playerA:'a',
    playerB:'b',
    winnerUid:'a',
    confirmed:true,
    ...overrides
  };
}

test('duplicate identical revision is idempotent, conflicting duplicate is rejected',()=>{
  const a=row();
  assert.equal(l.replay([a,a]).history.length,1);
  assert.throws(()=>l.replay([a,{...a,winnerUid:'b'}]),/revision-conflict/);
});

test('higher completed revision supersedes prior result deterministically',()=>{
  const first=row();
  const corrected={...first,revision:2,updatedAt:210,completedAt:200,winnerUid:'b'};
  const result=l.replay([first,corrected]);
  assert.equal(result.history.length,1);
  assert.equal(result.history[0].revision,2);
  assert.equal(result.history[0].winnerUid,'b');
  assert.ok(result.states.b.rating>p.DEFAULT_RATING);
  assert.ok(result.states.a.rating<p.DEFAULT_RATING);
});

test('latest revoke removes the match and replays downstream ratings from remaining active events',()=>{
  const first=row({eventCode:'BXH-A',matchId:'m1',completedAt:100,updatedAt:110,winnerUid:'a'});
  const second=row({eventCode:'BXH-B',matchId:'m2',completedAt:200,updatedAt:210,playerA:'a',playerB:'c',winnerUid:'a'});
  const before=l.replay([first,second]);
  const revoke={...first,revision:2,status:'revoked',winnerUid:null,confirmed:false,completedAt:null,updatedAt:300};
  const after=l.replay([first,second,revoke]);
  assert.equal(before.history.length,2);
  assert.equal(after.history.length,1);
  assert.equal(after.history[0].matchIdentity,'BXH-B|m2');
  assert.equal(after.history[0].beforeA,p.DEFAULT_RATING);
  assert.notEqual(before.history[1].beforeA,after.history[0].beforeA);
});

test('chronology uses completedAt, not input order or update order',()=>{
  const late=row({eventCode:'BXH-LATE',matchId:'m2',completedAt:200,updatedAt:900,playerA:'a',playerB:'c'});
  const early=row({eventCode:'BXH-EARLY',matchId:'m1',completedAt:100,updatedAt:100,playerA:'a',playerB:'b'});
  const result=l.replay([late,early]);
  assert.deepEqual(result.history.map(x=>x.matchIdentity),['BXH-EARLY|m1','BXH-LATE|m2']);
});

test('invalid sources, unconfirmed results and malformed players fail closed',()=>{
  assert.throws(()=>l.replay([row({source:'pk'})]),/source-invalid/);
  assert.throws(()=>l.replay([row({confirmed:false})]),/unconfirmed/);
  assert.throws(()=>l.replay([row({playerB:'a'})]),/player-invalid/);
});

test('replay outputs research rating only and does not manufacture Hunter grade or XP',()=>{
  const result=l.replay([row()]);
  assert.equal(result.providerVersion,p.VERSION);
  assert.equal(result.providerScale,p.SCALE);
  assert.equal(Object.hasOwn(result.states.a,'xp'),false);
  assert.equal(Object.hasOwn(result.states.a,'hunterGrade'),false);
  assert.equal(Object.hasOwn(result.states.a,'officialStrength'),false);
});

test('append validates whole ledger before accepting new revision',()=>{
  const ledger=l.append([],row());
  assert.equal(ledger.length,1);
  assert.throws(()=>l.append(ledger,{...row(),winnerUid:'b'}),/revision-conflict/);
});
