'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../../referee-seats/functions/bucket-state.cjs'),{mixedFixtureContext}=require('./mixed-fixture-context.cjs');
test('mixed comparison variants isolate durable receipt/audit paths and epochs',()=>{
 const fixtures=[128,320].flatMap(players=>[[B.schema,false],[B.perCourtSchema,false],[B.perCourtSchema,true]].map(([schema,deferred])=>mixedFixtureContext(players,schema,deferred)));
 assert.equal(new Set(fixtures.map(f=>f.code)).size,6);assert.equal(new Set(fixtures.map(f=>f.epoch)).size,6);
 for(const f of fixtures)assert.match(f.code,/^BXH-[A-Z0-9]{4,16}$/);
 // The handler keys receipts by uid + operationId within the room. A reused
 // operation ID is safe only when the containing fixture room is distinct.
 const operation='same-operation-id',uid='ref2';
 const receiptPaths=fixtures.map(f=>'tournaments/'+f.code+'/bucketScoreOperations/'+uid+':'+operation);
 assert.equal(new Set(receiptPaths).size,6);
 assert.deepEqual(mixedFixtureContext(128,B.perCourtSchema,true),mixedFixtureContext(128,B.perCourtSchema,true));
});
test('unsupported fixture variants fail before creating data',()=>{
 assert.throws(()=>mixedFixtureContext(64,B.schema),/invalid-mixed-fixture/);
 assert.throws(()=>mixedFixtureContext(128,B.schema,true),/invalid-mixed-fixture/);
 assert.throws(()=>mixedFixtureContext(128,'unknown'),/invalid-mixed-fixture/);
});
