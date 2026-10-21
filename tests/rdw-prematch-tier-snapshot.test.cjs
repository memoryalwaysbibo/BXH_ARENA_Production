const test=require('node:test'),assert=require('node:assert/strict');
const {buildPair,seal}=require('../scripts/lib/rdw-prematch-tier-snapshot.cjs');
const input={eventId:'event1',matchId:'match1',revision:0,playerA:'A',playerB:'B',tierA:'c',tierB:'b',capturedAt:100,matchStartedAt:101};
test('server prematch pair is reciprocal and consistent',()=>{
 const p=buildPair(input);assert.equal(p.a.selfTierBefore,'c');assert.equal(p.a.opponentTierBefore,'b');assert.equal(p.b.selfTierBefore,'b');assert.equal(p.b.opponentTierBefore,'c');assert.equal(p.a.capturedAt,p.b.capturedAt);assert.equal(p.a.version,p.b.version);
});
test('seal is immutable and idempotent',()=>{
 const first=seal(null,input);assert.equal(first.created,true);assert.equal(seal(first.pair,input).created,false);
 assert.throws(()=>seal(first.pair,{...input,tierB:'a'}),/snapshot-conflict/);
 assert.throws(()=>seal(first.pair,{...input,revision:1}),/snapshot-conflict/);
});
test('reject invalid identity, tier, time and client source',()=>{
 for(const patch of [{playerB:'A'},{playerA:''},{tierA:'x'},{capturedAt:101},{capturedAt:102},{capturedAt:0},{source:'client'},{revision:-1}])assert.throws(()=>buildPair({...input,...patch}));
});
