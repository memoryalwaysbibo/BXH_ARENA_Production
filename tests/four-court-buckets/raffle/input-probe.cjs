'use strict';
const assert=require('node:assert/strict');
const {fixture,code}=require('../completion/fixture.cjs');
const core=require('../operations/fixtures/5/operations-core.js');
const {createRaffleInput}=require('../../../release/buckets/raffle/input.cjs');
const read=createRaffleInput(core),privatePath='tournaments/'+code,publicPath='publicTournaments/'+code;
async function invoke(f,{mode='first_round',excluded=[],observed={}}={}){
 return f.m.db.runTransaction(async tx=>{
  const [root,pub]=await tx.getAll(f.m.db.doc(privatePath),f.m.db.doc(publicPath));
  return read({db:f.m.db,tx,root,pub,code,mode,excluded,observed});
 });
}
(async()=>{let checks=0;
 for(const courts of [4,6,12]){
  const f=fixture({courts}),top=f.m.rows.get(privatePath),stale=JSON.parse(top.data);
  for(const m of stale.matches.filter(m=>m.bracket==='SE'&&m.round===0))[m.winnerId,m.loserId]=[m.loserId,m.winnerId];
  f.m.put(privatePath,{...top,data:JSON.stringify(stale)});
  assert.deepEqual(core.candidates(stale,'first_round').map(p=>p.playerId),['p1','p3']);
  const before=JSON.stringify([...f.m.rows]),result=await invoke(f);
  assert.deepEqual(result.pool.map(p=>p.playerId),['p2','p4']);
  assert.equal(result.candidateHash,core.poolHash(core.candidates(f.state,'first_round')));
  assert.equal(JSON.stringify([...f.m.rows]),before);assert.equal(f.m.writes.length,0);checks++;
 }
 for(const mode of ['general','first_round']){
  const f=fixture({bucket:false}),result=await invoke(f,{mode});
  assert.deepEqual(result,{pool:core.candidates(f.state,mode),candidateHash:core.poolHash(core.candidates(f.state,mode))});checks++;
 }
 {const f=fixture(),r=await invoke(f,{mode:'general',excluded:['uid:u2']});assert.equal(r.pool.length,3);assert(!r.pool.some(x=>x.key==='uid:u2'));checks++;}
 for(const change of [
  f=>f.m.remove(privatePath+'/matchBuckets/court-2'),
  f=>f.m.put(privatePath+'/matchBuckets/court-1',{...f.buckets[0],epoch:'wrong'}),
  f=>f.m.put(privatePath+'/matchBuckets/court-1',{...f.buckets[0],matches:'{bad'}),
  f=>f.m.put(publicPath,{...f.pub,scoreBucketProjection:{epoch:'epoch-1',versions:{'court-1':8,'court-2':0}}}),
  f=>f.m.put(publicPath,{...f.pub,scoreStorage:null}),
  f=>f.m.put(privatePath,{...f.top,scoreBucketProjection:null}),
  f=>f.m.put(privatePath,{...f.top,archiveStatus:'completed'}),
 ]){const f=fixture();change(f);await assert.rejects(invoke(f));assert.equal(f.m.writes.length,0);checks++;}
 for(const side of [privatePath,publicPath])for(const field of ['bucketMigration','deletionStatus'])for(const value of [null,false]){
  const f=fixture();f.m.put(side,{...f.m.rows.get(side),[field]:value});await assert.rejects(invoke(f));assert.equal(f.m.writes.length,0);checks++;
 }
 for(const side of [privatePath,publicPath]){
  const f=fixture(),observed={};await invoke(f,{observed});const saved=f.m.rows.get(side);f.m.remove(side);f.m.put(side,saved);
  await assert.rejects(invoke(f,{observed}));assert.equal(f.m.writes.length,0);checks++;
 }
 {const f=fixture(),observed={};await invoke(f,{observed});const t=f.m.rows.get(privatePath),p=f.m.rows.get(publicPath);
  f.m.put(privatePath,{...t,scoreStorage:{...t.scoreStorage,epoch:'epoch-2'}});f.m.put(publicPath,{...p,scoreBucketProjection:{...p.scoreBucketProjection,epoch:'epoch-2'}});
  for(const b of f.buckets)f.m.put(privatePath+'/matchBuckets/'+b.bucketId,{...b,epoch:'epoch-2'});
  await assert.rejects(invoke(f,{observed}),/raffle-room-changed/);checks++;
 }
 {const f=fixture(),observed={};const first=await invoke(f,{observed});f.m.put(privatePath+'/matchBuckets/court-1',{...f.buckets[0],revision:8});assert.deepEqual(await invoke(f,{observed}),first);assert.equal(f.m.writes.length,0);checks++;}
 console.log(JSON.stringify({raffleInputChecks:checks,productionWrites:0,callableWired:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
