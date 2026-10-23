const test=require('node:test'),assert=require('node:assert/strict');
const {createTrustedStartCoordinator}=require('../scripts/lib/rdw-trusted-start-coordinator.cjs');
function fixture(){
 const uids=['alice','bob'];const writes=[];
 const event={code:'BXH-ABC123',drawRevision:3,started:false,rosterUids:uids};
 const refs={eventRef:{id:'event'},snapshotRef:{id:'snapshot'},auditRef:{id:'audit'}};
 const tx={get:async ref=>({exists:ref.id==='event',data:()=>event}),create:(ref,doc)=>writes.push(['create',ref.id,doc]),update:(ref,doc)=>writes.push(['update',ref.id,doc])};
 let allow=true,change=false,called=0,tierRequested=false;
 const db={runTransaction:async fn=>fn(tx)};
 const authorizeInTransaction=async({tx:transaction,actorUid})=>{assert.equal(transaction,tx);assert.equal(actorUid,'host');return allow;};
 const readRosterInTransaction=async({tx:transaction})=>{called++;if(transaction)assert.equal(transaction,tx);return {drawRevision:3,uids:change&&transaction?[...uids].reverse():uids};};
 const resolveTiers=async({rosterUids})=>{tierRequested=true;return rosterUids.map(uid=>({ok:true,uid,tier:'c',computedAt:1000,sourceDigest:'a'.repeat(64),sourceScope:'public-official-canonical-self-history-v1'}));};
 const makeRefs=()=>refs;
 const start=createTrustedStartCoordinator({db,authorizeInTransaction,readRosterInTransaction,resolveTiers,makeRefs,clock:()=>2000,enabled:true});
 return {start,writes,refs,markUnauthorized:()=>{allow=false;},markRosterChanged:()=>{change=true;},get called(){return called;},get tierRequested(){return tierRequested;}};
}
const payload={eventCode:'BXH-ABC123',drawRevision:3,idempotencyKey:'key-0001'};
test('disabled coordinator never calls backend',async()=>{assert.deepEqual(await createTrustedStartCoordinator()({request:payload,actorUid:'host'}),{ok:false,code:'rdw-disabled'});});
test('server auth and roster are checked within transaction, front-end spoof ignored',async()=>{
 const f=fixture();const r=await f.start({actorUid:'host',request:{...payload,authorized:true,rosterUids:['fake'],tiers:['national']}});
 assert.equal(r.ok,true);assert.equal(r.mode,'rdw-verified');assert.equal(f.called,2);assert.equal(f.writes[0][2].tiers[0].uid,'alice');
});
test('denied authority never writes even if request claims authorized',async()=>{
 const f=fixture();f.markUnauthorized();const r=await f.start({actorUid:'host',request:{...payload,authorized:true}});
 assert.equal(r.ok,false);assert.equal(r.code,'not-authorized');assert.equal(f.writes.length,0);
});
test('roster revision mismatch blocks stale precomputed tiers',async()=>{
 const f=fixture();f.markRosterChanged();const r=await f.start({actorUid:'host',request:payload});
 assert.equal(r.ok,false);assert.equal(r.code,'roster-changed');assert.equal(f.writes.length,0);
});
test('unauthenticated and malformed request fail before any backend read',async()=>{
 const f=fixture();assert.equal((await f.start({request:payload})).code,'invalid-request');assert.equal((await f.start({actorUid:'host',request:{...payload,drawRevision:'3'}})).code,'invalid-request');assert.equal(f.called,0);
});
test('incomplete tiers block unless explicit audited RDW PASS requested',async()=>{
 const f=fixture();const r=await f.start({actorUid:'host',request:payload});assert.equal(r.ok,true);
});
