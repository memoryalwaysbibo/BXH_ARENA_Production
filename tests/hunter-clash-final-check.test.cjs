'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const adapter = require('../hunter-clash/arena/adapter.js');
globalThis.BXHArenaPKAdapter = adapter;
const { createHistory } = require('../hunter-clash/arena/history.js');
const achievements = require('../hunter-clash/arena/achievements.js');
const { createService } = require('../hunter-clash/arena/service.cjs');
const { memory } = require('./helpers/arena-pk-memory.cjs');

function fixture(){
  const m = memory();
  let now = Date.parse('2026-10-11T00:00:00+08:00');
  let seq = 0;
  for (const uid of ['a','b','admin']) {
    m.data.set('users/'+uid,{active:true,role:uid==='admin'?'super_admin':'player',displayName:uid});
  }
  m.data.set('systemSettings/hunterClash',{
    enabled:true,
    environment:adapter.ENV,
    allowedUids:['a','b'],
    pairingTtlMs:120000,
    rules:{version:adapter.VERSION,targetScore:4}
  });
  const auth = {
    app:{options:{projectId:m.db.projectId}},
    verifyIdToken:async token=>({uid:token})
  };
  const service = createService({db:m.db,auth,clock:()=>++now});
  const call = (uid,operation,input={}) => service.run(uid,operation,{
    ...input,
    ...(!['getMyHistory','getChallenge'].includes(operation)?{requestId:'r'+(++seq)}:{})
  });
  const transport = uid => async (operation,input) => call(uid,operation,input);
  return {...m,service,call,transport};
}

async function completedComebackRoom(f){
  const created = await f.call('a','createChallenge',{matchCount:1});
  let c = (await f.call('b','acceptCode',{pairingCode:created.pairingCode,expectedRevision:0})).challenge;
  for (const uid of ['a','b']) c = (await f.call(uid,'start',{challengeId:c.challengeId,expectedRevision:c.revision})).challenge;

  c = (await f.call('b','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:'b',finish:'extreme'})).challenge;
  c = (await f.call('a','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:'a',finish:'burst'})).challenge;
  c = (await f.call('a','recordRound',{challengeId:c.challengeId,expectedRevision:c.revision,winnerUid:'a',finish:'burst'})).challenge;

  for (const uid of ['a','b']) {
    c = (await f.call(uid,'confirmFinish',{challengeId:c.challengeId,expectedRevision:c.revision,resultRevision:c.resultRevision})).challenge;
  }
  assert.equal(c.status,'completed');
  return c;
}

async function loadFreshDevice(f,uid){
  const store = createHistory({transport:f.transport(uid)});
  store.session(uid);
  return {store,state:await store.load(true)};
}

test('fresh device reconstructs completed PK, XP and achievements from authoritative history', async()=>{
  const f = fixture();
  await completedComebackRoom(f);

  const first = await loadFreshDevice(f,'a');
  assert.equal(first.state.status,'ready');
  assert.equal(first.state.records.length,1);
  assert.equal(first.state.records[0].scoreFor,4);
  assert.equal(first.state.records[0].scoreAgainst,3);
  assert.equal(first.state.practiceXp.totalXp,5);

  const firstBadges = achievements.presentation(first.state.records);
  assert.equal(firstBadges.badges.find(b=>b.id==='first').unlocked,true);
  assert.equal(firstBadges.badges.find(b=>b.id==='first_win').unlocked,true);
  assert.equal(firstBadges.badges.find(b=>b.id==='comeback').unlocked,true);

  // Simulate leaving the page / changing device: no cache or local presentation state is reused.
  const second = await loadFreshDevice(f,'a');
  assert.notEqual(second.store,first.store);
  assert.equal(second.state.status,'ready');
  assert.equal(second.state.records.length,1);
  assert.deepEqual(
    second.state.records.map(r=>({eventCode:r.eventCode,matchId:r.matchId,scoreFor:r.scoreFor,scoreAgainst:r.scoreAgainst,isWin:r.isWin})),
    first.state.records.map(r=>({eventCode:r.eventCode,matchId:r.matchId,scoreFor:r.scoreFor,scoreAgainst:r.scoreAgainst,isWin:r.isWin}))
  );
  assert.equal(second.state.practiceXp.totalXp,5);
  const secondBadges = achievements.presentation(second.state.records);
  assert.deepEqual(
    secondBadges.badges.map(b=>({id:b.id,current:b.current,unlocked:b.unlocked})),
    firstBadges.badges.map(b=>({id:b.id,current:b.current,unlocked:b.unlocked}))
  );

  // Another account must rehydrate only its own perspective and data.
  const opponent = await loadFreshDevice(f,'b');
  assert.equal(opponent.state.records.length,1);
  assert.equal(opponent.state.records[0].scoreFor,3);
  assert.equal(opponent.state.records[0].scoreAgainst,4);
  assert.equal(achievements.presentation(opponent.state.records).badges.find(b=>b.id==='comeback').unlocked,false);
});

test('revocation is reflected on a brand-new runtime and cannot leave ghost XP or badges', async()=>{
  const f = fixture();
  const room = await completedComebackRoom(f);
  const before = await loadFreshDevice(f,'a');
  assert.equal(before.state.records.length,1);
  assert.equal(before.state.practiceXp.totalXp,5);
  assert.equal(achievements.presentation(before.state.records).badges.find(b=>b.id==='comeback').unlocked,true);

  await f.call('admin','revokeChallenge',{
    challengeId:room.challengeId,
    expectedRevision:room.revision,
    reason:'final-check-revocation'
  });

  const after = await loadFreshDevice(f,'a');
  assert.equal(after.state.status,'empty');
  assert.equal(after.state.records.length,0);
  assert.equal(after.state.practiceXp.totalXp,0);
  const badges = achievements.presentation(after.state.records);
  assert.equal(badges.badges.some(b=>b.unlocked),false);
  assert.equal(badges.badges.find(b=>b.id==='comeback').current,0);
});

test('legacy or policy-less PK records cannot unlock current PK achievements', ()=>{
  const legacy = [{
    sourceType:'hunter-clash',
    eventCode:'pk:arena-internal:legacy-room',
    matchId:'legacy-game',
    completed:true,
    tombstone:false,
    analyzable:true,
    isWin:true,
    confirmedAt:Date.parse('2026-10-10T12:00:00+08:00'),
    opponent:{uid:'legacy-opponent'},
    roundsPerspective:[
      {perspective:'against',points:3},
      {perspective:'for',points:2},
      {perspective:'for',points:2}
    ]
  }];
  const summary = achievements.presentation(legacy);
  assert.equal(summary.matches,0);
  assert.equal(summary.wins,0);
  assert.equal(summary.comebacks,0);
  assert.equal(summary.badges.some(b=>b.unlocked),false);
});
