'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {db,seed,load}=require('./harness.cjs');
const fixture=require('./captured-family-source.json');
const {addFamilyRosterReceipt}=require('../../qr-checkin/backend/overlays/family-roster-receipt.cjs');
const baseline=fixture.blobs[fixture.files['family-registration.js']];
const candidate={exports:{}};
new Function('require','module','exports',addFamilyRosterReceipt(baseline))(
  name=>name.startsWith('./')?load(name.slice(2)+(/\.(?:js|cjs)$/.test(name)?'':'.js')):require(name),candidate,candidate.exports);
const handler=candidate.exports.createFamilyRegistration(db);

test('roster receipt is owner-only, matches the committed roster and keeps the no-change sync read-only',async()=>{
  const {code,ids:[owner,player]}=await seed(2);
  const room=db.doc('tournaments/'+code),mirror=db.doc('publicTournaments/'+code);
  const state={id:code,players:[],waitlistPlayers:[],matches:[],meta:{eventAuthority:'community'},registrationRosterRevision:26};
  const identity={createdBy:owner,ownerUid:owner,eventAuthority:'community',communityQuickRegistration:true,confirmedCount:1};
  const batch=db.batch();
  batch.update(room,{...identity,data:JSON.stringify(state)});
  batch.update(mirror,{...identity,bracketView:JSON.stringify(state)});
  batch.set(room.collection('registrations').doc(player),{status:'confirmed',uid:player,displayName:'Synthetic'});
  await batch.commit();
  const sync=(uid,includeRoster=true)=>handler({auth:{uid},data:{action:'syncSummary',code,operationId:'receipt-test-01',includeRoster}});
  await assert.rejects(sync(player),/permission-denied/);
  const result=await sync(owner);
  const saved=await room.get(),published=await mirror.get();
  assert.equal(result.rosterReceipt.code,code);
  assert.equal(result.rosterReceipt.room.createdBy,owner);
  assert.equal(result.rosterReceipt.room.data,saved.data().data);
  assert.equal(JSON.parse(result.rosterReceipt.room.data).registrationRosterRevision,27);
  assert.equal(JSON.parse(published.data().bracketView).registrationRosterRevision,27);
  assert.equal(result.communityParticipantCount,1);
  for(const field of ['roomReadMs','registrationReadMs','transactionMs','serverMs'])
    assert(Number.isFinite(result.rosterReceipt.timing[field])&&result.rosterReceipt.timing[field]>=0);
  assert.deepEqual(await sync(owner,false),{ok:true,communityParticipantCount:1});
  assert.equal((await sync(owner)).rosterReceipt.room.data,saved.data().data);
  assert((await room.get()).updateTime.isEqual(saved.updateTime));
  await room.update({tournamentPhase:'live'});
  await assert.rejects(sync(owner),/tournament-started/);
});

test('a different source must be reviewed before generating a candidate',()=>{
  assert.throws(()=>addFamilyRosterReceipt(baseline+'\n'),/family-roster-source-not-reviewed/);
});
