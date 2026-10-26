'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8');
const start=src.indexOf('async pushUpdate('),guard=src.indexOf('rdw-server-start-stale',start);
test('existing cloud pushUpdate transaction fences only server-sealed ranked starts',()=>{
 assert.ok(start>0&&guard>start);
 const excerpt=src.slice(guard-1100,guard+1100);
 assert.match(excerpt,/remoteDoc\.rdwStartMode==="rdw-verified"/);
 assert.match(excerpt,/remoteDoc\.rdwStartMode==="rdw-pass"/);
 assert.match(excerpt,/remoteState\.meta\?\.ladderMode!=="ranked"/);
 assert.match(excerpt,/Number\(data\.startedAt\)!==sealedStart/);
 assert.match(excerpt,/data\.rosterLocked!==true/);
});
test('server RDW start fence precedes regular bracket and match revision writes',()=>{
 const fence=src.indexOf('rdw-server-start-stale',start);
 const bracket=src.indexOf('BXHBracketCommit.assertWrite(remoteState,data,options)',start);
 const revision=src.indexOf('registration-roster-stale',start);
 assert.ok(fence<bracket&&fence<revision);
});
test('server mode and digest cannot be replaced but unchanged clients remain able to sync score',()=>{
 const excerpt=src.slice(guard-1300,guard+1300);
 assert.match(excerpt,/data\.rdwStartMode!==undefined&&data\.rdwStartMode!==remoteDoc\.rdwStartMode/);
 assert.match(excerpt,/data\.rdwSnapshotDigest!==undefined&&/);
 assert.match(excerpt,/rdw-server-snapshot-stale/);
 assert.doesNotMatch(excerpt,/data\.rdwStartMode===undefined\)throw/);
});

test('server-sealed ranked state is re-inserted before serialization of private JSON and public mirror',()=>{
 const start=src.indexOf('async pushUpdate('),fence=src.indexOf('rdw-server-start-stale',start);
 const modeRebase=src.indexOf('data.rdwStartMode=remoteDoc.rdwStartMode',fence);
 const digestRebase=src.indexOf('data.rdwSnapshotDigest=remoteDoc.rdwSnapshotDigest',fence);
 const persist=src.indexOf('tx.set(ref,privatePayload,{merge:true})',fence);
 assert.ok(start>=0&&modeRebase>fence&&digestRebase>modeRebase&&persist>digestRebase);
 assert.match(src.slice(fence-650,fence),/rdw-server-mode-type-mismatch/);
});
