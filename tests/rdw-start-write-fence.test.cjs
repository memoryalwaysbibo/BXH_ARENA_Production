const test=require('node:test'),assert=require('node:assert/strict');
const {inspectStartWriteFence}=require('../scripts/lib/rdw-start-write-fence.cjs');
const ranked={meta:{ladderMode:'ranked'},startedAt:1000,rosterLocked:true};
const sealed={rdwStartMode:'rdw-verified',rdwSnapshotDigest:'a'.repeat(64)};
test('stale browser cannot roll back a server started ranked event',()=>{
 for(const proposed of [{...ranked,startedAt:null},{...ranked,startedAt:999},{...ranked,rosterLocked:false},{...ranked,rdwStartMode:'rdw-pass',rdwSnapshotDigest:sealed.rdwSnapshotDigest},{...ranked,rdwStartMode:'rdw-verified',rdwSnapshotDigest:'b'.repeat(64)}])
  assert.equal(inspectStartWriteFence({remote:ranked,proposed,remoteDoc:sealed}).ok,false);
});
test('identical server start metadata remains safe for further score syncing',()=>{
 assert.equal(inspectStartWriteFence({remote:ranked,proposed:{...ranked,rdwStartMode:'rdw-verified',rdwSnapshotDigest:sealed.rdwSnapshotDigest},remoteDoc:sealed}).ok,true);
});
test('new browser ranked start is blocked until backend has attested it',()=>{
 assert.equal(inspectStartWriteFence({remote:{meta:{ladderMode:'ranked'},startedAt:null},proposed:{startedAt:1000}}).reason,'client-cannot-transition-start');
});
test('general tournaments retain legacy browser start and scoring',()=>{
 const remote={meta:{ladderMode:'general'},startedAt:null};const proposed={...remote,startedAt:1000};
 assert.deepEqual(inspectStartWriteFence({remote,proposed}),{ok:true,rdwApplicable:false});
});

test('old ranked browsers may omit RDW metadata without erasing the server seal',()=>{
 const verdict=inspectStartWriteFence({remote:ranked,proposed:{...ranked},remoteDoc:sealed});
 assert.deepEqual(verdict,{ok:true,rdwApplicable:true});
});
test('server-sealed event cannot be downgraded to general mode',()=>{
 assert.equal(inspectStartWriteFence({remote:ranked,proposed:{...ranked,meta:{ladderMode:'general'}},remoteDoc:sealed}).reason,'rdw-server-mode-type-mismatch');
 assert.equal(inspectStartWriteFence({remote:{...ranked,meta:{ladderMode:'general'}},proposed:ranked,remoteDoc:sealed}).reason,'rdw-server-mode-type-mismatch');
});
