'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
const {validateSealedSnapshot}=require('../scripts/lib/rdw-sealed-snapshot-verifier.cjs');
const eventCode='BXH-ABC123',drawRevision=9,rosterUids=['u1','u2'];
const tier=uid=>({ok:true,uid,tier:'d',computedAt:100,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)});
const snapshot=buildRosterSnapshot({eventCode,drawRevision,rosterUids,verifiedTiers:rosterUids.map(tier),capturedAt:150});
test('valid roster-bound SHA256 snapshot passes',()=>assert.equal(validateSealedSnapshot({snapshot,eventCode,drawRevision,rosterUids}).ok,true));
test('fake sealed flag or forged tier with unchanged digest cannot pass',()=>{
 for(const changed of [{snapshotDigest:'b'.repeat(64)},{tiers:[{...snapshot.tiers[0],tier:'national'},snapshot.tiers[1]]},{rosterDigest:'0'.repeat(64)},{verified:false},{capturedAt:50}]){
  assert.equal(validateSealedSnapshot({snapshot:{...snapshot,...changed},eventCode,drawRevision,rosterUids}).ok,false);
 }
});
test('stale or rearranged roster cannot use earlier snapshot',()=>{
 for(const uids of [['u2','u1'],['u1','different']])assert.equal(validateSealedSnapshot({snapshot,eventCode,drawRevision,rosterUids:uids}).ok,false);
 assert.equal(validateSealedSnapshot({snapshot,eventCode,drawRevision:10,rosterUids}).ok,false);
});
