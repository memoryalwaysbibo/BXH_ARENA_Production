const test=require('node:test'),assert=require('node:assert/strict');
const {createRdwStartService}=require('../scripts/lib/rdw-start-service-preflight.cjs');
const args={eventCode:'BXH-SDSAQZ',drawRevision:1,actorUid:'host',idempotencyKey:'test-1'};
const deps={db:{runTransaction:async()=>{throw Error('must-not-write');}},authorize:async()=>true,resolveRoster:async()=>({valid:true,drawRevision:1,uids:['u1','u2']}),resolveCurrentTiers:async()=>null,makeRefs:()=>({eventRef:{},auditRef:{},snapshotRef:{}}),clock:()=>123};
test('feature OFF does not access backend or mutate',async()=>{const start=createRdwStartService({...deps,enabled:false});assert.deepEqual(await start(args),{ok:false,code:'rdw-disabled'});});
test('authorization and roster fail closed before transaction',async()=>{
 assert.equal((await createRdwStartService({...deps,enabled:true,authorize:async()=>false})(args)).code,'not-authorized');
 assert.equal((await createRdwStartService({...deps,enabled:true,resolveRoster:async()=>({valid:true,drawRevision:1,uids:['u1','u1']})})(args)).code,'roster-invalid');
});
test('unverified tiers cannot silently start without PASS',async()=>{const result=await createRdwStartService({...deps,enabled:true})(args);assert.equal(result.code,'rdw-snapshot-unavailable');assert.equal(result.passAvailable,true);});
test('enabled service refuses missing trusted integrations',()=>{assert.throws(()=>createRdwStartService({enabled:true,db:deps.db}),/trusted-dependencies-required/);});
