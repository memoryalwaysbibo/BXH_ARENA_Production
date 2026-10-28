'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createArchiveActivityHandler}=require('./activity-archive.cjs');
const event=rows=>({params:{code:'BXH-ABC123'},data:{after:{exists:true,data:()=>({archiveStatus:'completed',ladderPointsAwarded:true,data:JSON.stringify({archiveStatus:'completed',ladderPointsAwarded:true}),ladderResults:rows})}}});
test('archive fallback accepts both server result shapes and deduplicates identities',async()=>{
 const calls=[];const run=createArchiveActivityHandler({enabled:()=>true,award:async id=>{calls.push(id);return {status:'awarded'};}});
 assert.deepEqual(await run(event([{playerId:'a'},{playerUid:'b'},{playerId:'a'}])),{status:'processed',examined:2,awarded:2});assert.deepEqual(calls.sort(),['BXH-ABC123_a','BXH-ABC123_b']);
});
test('disabled and incomplete archives do not call award; oversized lists fail closed',async()=>{
 const award=async()=>{throw Error('must-not-run');};assert.equal((await createArchiveActivityHandler({award})(event([]))).status,'disabled');
 const run=createArchiveActivityHandler({award,enabled:()=>true});const e=event([]);e.data.after.data=()=>({archiveStatus:'pending'});assert.equal((await run(e)).status,'ineligible');await assert.rejects(run(event(Array(513).fill({playerId:'a'}))),/invalid-archive-results/);
});
test('archive fanout is bounded and requests retry after any worker failure',async()=>{
 let active=0,peak=0,called=0;const run=createArchiveActivityHandler({enabled:()=>true,award:async id=>{active++;peak=Math.max(peak,active);called++;await new Promise(r=>setTimeout(r,2));active--;if(id.endsWith('_b'))throw Error('transient');return {status:'already-awarded'};}});
 await assert.rejects(run(event(['a','b','c','d','e'].map(playerId=>({playerId})))),/retry-required/);assert.equal(called,5);assert.ok(peak<=3);
});
test('unrelated tournament fields do not rescan unchanged settlement data',async()=>{
 const e=event([{playerId:'a'}]);e.data.before={exists:true,data:()=>({...e.data.after.data(),updatedAt:1})};
 const run=createArchiveActivityHandler({enabled:()=>true,award:async()=>{throw Error('must-not-run');}});assert.equal((await run(e)).status,'unchanged');
});
