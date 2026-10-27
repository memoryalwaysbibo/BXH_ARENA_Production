'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {EXPECTED_FILES}=require('../scripts/lib/rdw-hunter-bundle-loader.cjs');
const {createHunterVerifiedRankedStart}=require('../scripts/lib/rdw-hunter-start-wiring.cjs');
const eventCode='BXH-HUNT55';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function makeBundle(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-hunter-start-'));fs.mkdirSync(path.join(root,'vendor'));
 const files={'reader.cjs':"module.exports={createReader:()=>async({uid})=>({uid,version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,sourceDigest:'a'.repeat(64),sourceScope:'public-official-canonical-self-history-v1',overview:{grade:{tier:'d'}}})};"};
 const manifest={};
 for(const name of EXPECTED_FILES){const contents=files[name]||'{}';const target=path.join(root,name);fs.writeFileSync(target,contents);manifest[name]=digest(contents);}
 fs.writeFileSync(path.join(root,'bundle-manifest.json'),JSON.stringify(manifest));return root;
}
function makeDb({general=false,role='staff',badRoster=false}={}){
 const ids=['u1','u2'],players=ids.map((uid,i)=>({uid,id:'p'+i}));
 const matches=[{id:'m1',a:{playerId:'p0'},b:{playerId:'p1'},completed:false}];
 const state={cloudCode:eventCode,createdBy:'actor',registrationRosterRevision:4,meta:{ladderMode:general?'general':'ranked',eventAuthority:'official',stations:1},players:badRoster?[players[0],{id:'virtual'}]:players,matches,drawnAt:100,startedAt:null,rosterLocked:false};
 const docs={
  ['tournaments/'+eventCode]:{code:eventCode,createdBy:'actor',eventAuthority:'official',data:JSON.stringify(state)},
  ['publicTournaments/'+eventCode]:{bracketView:JSON.stringify({cloudCode:eventCode,registrationRosterRevision:4,players:state.players,matches,drawnAt:100,startedAt:null})},
  ['users/actor']:{role,active:true},'users/u1':{role:'player',active:true},'users/u2':{role:'player',active:true}
 };
 const writes=[],reads=[];
 const db={doc:p=>({path:p}),runTransaction:async fn=>fn({
  get:async ref=>{reads.push(ref.path);return {exists:!!docs[ref.path],data:()=>docs[ref.path]};},
  update:(ref,data)=>writes.push({path:ref.path,data}),create:(ref,data)=>writes.push({path:ref.path,data})
 })};
 const buildServerDispatch=async({tx})=>({matches:JSON.parse((await tx.get(db.doc('tournaments/'+eventCode))).data().data).matches,courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:null}}});
 return {db,writes,reads,buildServerDispatch};
}
const req={eventCode,actorUid:'actor',expectedRosterRevision:4,drawRevision:7};
test('audited Hunter reader creates a SHA256 sealed snapshot and both mirrors',async t=>{
 const bundleRoot=makeBundle();t.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));
 const f=makeDb();const run=createHunterVerifiedRankedStart({db:f.db,clock:()=>200,bundleRoot,verifyBracketInTransaction:async()=>true,buildServerDispatch:f.buildServerDispatch,enabled:true});
 const result=await run(req);assert.equal(result.ok,true);
 assert.deepEqual(f.writes.map(x=>x.path),['rdwSnapshots/'+eventCode,'tournaments/'+eventCode,'publicTournaments/'+eventCode]);
 assert.equal(f.writes[0].data.rosterSize,2);
 assert.equal(JSON.parse(f.writes[1].data.data).rdwSnapshotDigest,f.writes[0].data.snapshotDigest);
 assert.ok(f.reads.includes('users/u1')&&f.reads.includes('users/u2'));
});
test('general tournament and untrusted actor never trigger Hunter reads or writes',async t=>{
 const bundleRoot=makeBundle();t.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));
 for(const f of [makeDb({general:true}),makeDb({role:'player'})]){
  const run=createHunterVerifiedRankedStart({db:f.db,clock:()=>200,bundleRoot,verifyBracketInTransaction:async()=>true,enabled:true});
  const result=await run(req);
  assert.equal(result.ok,false);assert.equal(f.writes.length,0);
  assert.equal(f.reads.includes('users/u1'),false);
 }
});
test('incomplete roster denies tier snapshot and all writes',async t=>{
 const bundleRoot=makeBundle();t.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));
 const f=makeDb({badRoster:true});
 const run=createHunterVerifiedRankedStart({db:f.db,clock:()=>200,bundleRoot,verifyBracketInTransaction:async()=>true,enabled:true});
 await assert.rejects(run(req),/trusted-roster-required|invalid-uid|trusted-hunter-tier-unavailable/);
 assert.equal(f.writes.length,0);
});
test('feature disabled without bundle or database access',async()=>{
 const run=createHunterVerifiedRankedStart({enabled:false});
 assert.deepEqual(await run(req),{ok:false,code:'rdw-disabled'});
});
test('missing trusted dispatch producer cannot be bypassed by Hunter tier verification',async t=>{
 const bundleRoot=makeBundle();t.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));
 const f=makeDb(),run=createHunterVerifiedRankedStart({db:f.db,clock:()=>200,bundleRoot,verifyBracketInTransaction:async()=>true,enabled:true});
 const result=await run(req);assert.equal(result.ok,false);assert.equal(result.code,'server-dispatch-unavailable');assert.equal(f.writes.length,0);
});

test('advancing server clock captures the baseline after all Hunter reads finish',async t=>{
 const bundleRoot=makeBundle();t.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));
 const f=makeDb();let now=200;
 const run=createHunterVerifiedRankedStart({db:f.db,clock:()=>++now,bundleRoot,verifyBracketInTransaction:async()=>true,buildServerDispatch:f.buildServerDispatch,enabled:true});
 const out=await run(req);assert.equal(out.ok,true);
 const snapshot=f.writes.find(w=>w.path==='rdwSnapshots/'+eventCode).data;
 assert.ok(snapshot.tiers.every(t=>t.computedAt<=snapshot.capturedAt));
 const started=JSON.parse(f.writes.find(w=>w.path==='tournaments/'+eventCode).data.data).startedAt;
 assert.ok(snapshot.capturedAt<started);
});
