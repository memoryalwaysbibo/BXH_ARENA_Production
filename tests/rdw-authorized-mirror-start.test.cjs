const {buildRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
const makeSnapshot=(eventCode,drawRevision,rosterUids)=>buildRosterSnapshot({eventCode,drawRevision,rosterUids,capturedAt:150,verifiedTiers:rosterUids.map(uid=>({ok:true,uid,tier:'d',computedAt:100,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)}))});
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAuthorizedMirrorStart}=require('../scripts/lib/rdw-authorized-mirror-start.cjs');
const code='BXH-ABC123';
function fixture({mode='ranked',role='staff',bracketOk=true,creator='actor',changed=false}={}){
 const players=[{id:'p1',uid:'u1'},{id:'p2',uid:'u2'}];
 const matches=[{id:'m',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}];
 const state={cloudCode:code,createdBy:creator,registrationRosterRevision:4,meta:{ladderMode:mode,eventAuthority:'official'},players,matches,drawnAt:100,startedAt:null,rosterLocked:false};
 const publicState={cloudCode:code,registrationRosterRevision:4,players,matches,drawnAt:100,startedAt:null};
 const docs={
  ['tournaments/'+code]:{createdBy:creator,eventAuthority:'official',code,data:JSON.stringify(state)},
  ['users/actor']:{role,active:true},
  ['publicTournaments/'+code]:{bracketView:JSON.stringify(publicState)},
  ['rdwSnapshots/'+code]:makeSnapshot(code,9,['u1','u2'])
 };
 const writes=[],reads=[];
 const tx={get:async ref=>{reads.push(ref.path);const val=docs[ref.path];return {exists:!!val,data:()=>val};},update:(ref,payload)=>writes.push({path:ref.path,payload})};
 const db={doc:path=>({path}),runTransaction:fn=>fn(tx)};
 const start=createAuthorizedMirrorStart({db,clock:()=>200,verifyBracketInTransaction:async()=>bracketOk,enabled:true});
 const args={eventCode:code,actorUid:'actor',expectedRosterRevision:changed?5:4,drawRevision:9};
 return {start,args,writes,reads};
}
test('single transaction authorizes and verifies both canonical mirrors before writing',async()=>{
 const f=fixture(),r=await f.start(f.args);
 assert.equal(r.ok,true);assert.deepEqual(f.writes.map(x=>x.path),['tournaments/'+code,'publicTournaments/'+code]);
 assert.ok(f.reads.includes('users/actor'));assert.ok(f.reads.includes('rdwSnapshots/'+code));
 assert.equal(JSON.parse(f.writes[0].payload.data).rdwSnapshotDigest,makeSnapshot(code,9,['u1','u2']).snapshotDigest);
});
test('general event, unauthorized actor, bracket mismatch and revision change never write',async()=>{
 for(const config of [{mode:'general'},{role:'player'},{bracketOk:false},{changed:true}]){
  const f=fixture(config);assert.equal((await f.start(f.args)).ok,false);assert.equal(f.writes.length,0);
 }
});
test('disabled start performs no reads or writes',async()=>{
 const f=fixture(),disabled=createAuthorizedMirrorStart({enabled:false});
 assert.deepEqual(await disabled(f.args),{ok:false,code:'rdw-disabled'});assert.equal(f.writes.length,0);
});
test('invalid requests cannot reach server transaction',async()=>{
 const f=fixture();assert.deepEqual(await f.start({...f.args,eventCode:'wrong'}),{ok:false,code:'invalid-request'});assert.equal(f.reads.length,0);
});
