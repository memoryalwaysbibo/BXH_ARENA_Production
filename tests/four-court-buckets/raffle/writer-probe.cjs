'use strict';
const assert=require('node:assert/strict');
const {fixture,code,NOW}=require('../completion/fixture.cjs');
const core=require('../operations/fixtures/5/operations-core.js');
const {createRafflePreview}=require('../../../release/buckets/raffle/preview.cjs');
const {createRaffleWriters}=require('../../../release/buckets/raffle/writers.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const root='tournaments/'+code,ledger=root+'/raffleControl/current',pub='publicTournaments/'+code;
const request=data=>({auth:{uid:'admin'},data:{code,mode:'general',...data}});
function services(f,options={}){const opts={db:f.m.db,core,HttpsError,now:()=>NOW,select:(pool,count)=>core.draw(pool,count,(min,max)=>min),...options};return {preview:createRafflePreview(opts),...createRaffleWriters(opts)};}
function family(f){const top=f.m.rows.get(root),s=JSON.parse(top.data);s.players[1].registrationUid=s.players[0].registrationUid;s.players[1].name=s.players[0].name;f.m.put(root,{...top,data:JSON.stringify(s)});}
const prizes=[{name:'Prize A',description:'A',quantity:1},{name:'Prize B',description:'B',quantity:1}];
async function prepare(f,s=services(f),op='draw-1'){const preview=await s.preview(request({})),payload={operationId:op,prizes,candidateHash:preview.candidateHash};return {s,payload,preview};}
(async()=>{let checks=0;
 async function rejectUnchanged(f,promise,pattern){const before=JSON.stringify([...f.m.rows]),writes=f.m.writes.length;await assert.rejects(promise,pattern);assert.equal(JSON.stringify([...f.m.rows]),before);assert.equal(f.m.writes.length,writes);checks++;}
 for(const bucket of [false,true]){
  const f=fixture({bucket});family(f);const {s,payload,preview}=await prepare(f);assert.equal(preview.count,4);
  const protectedRows=JSON.stringify([...f.m.rows].filter(([p])=>p===root||p===pub||p.includes('/matchBuckets/')));
  const result=await s.draw(request(payload));assert.equal(result.identityVersion,'participant-v1');assert.equal(result.winners.length,2);assert.notEqual(result.winners[0].key,result.winners[1].key);assert.deepEqual(result.winners.map(w=>w.playerId),['p1','p2']);assert.equal(f.m.rows.get(ledger).winnerKeys.length,2);checks++;
  assert.equal(JSON.stringify([...f.m.rows].filter(([p])=>p===root||p===pub||p.includes('/matchBuckets/'))),protectedRows);checks++;
  const writes=f.m.writes.length,replayed=await s.draw(request(payload));assert.equal(replayed.replayed,true);assert.equal(f.m.writes.length,writes);checks++;
  await rejectUnchanged(f,s.draw(request({...payload,prizes:[{name:'changed',quantity:2}]})),/operation-conflict/);
  await rejectUnchanged(f,s.draw(request({...payload,candidateHash:'changed'})),/operation-conflict/);
  assert.equal((await s.preview(request({}))).count,2);checks++;
  const a=result.winners[0],b=result.winners[1],update=(action,winnerKey,operationId,reason='test reason')=>request({raffleId:result.id,action,winnerKey,operationId,reason});
  await s.update(update('claim',a.key,'claim-1'));assert.equal(f.m.rows.get(root+'/raffles/'+result.id).winners[0].status,'claimed');checks++;
  const beforeReplay=f.m.writes.length;assert.equal((await s.update(update('claim',a.key,'claim-1'))).replayed,true);assert.equal(f.m.writes.length,beforeReplay);checks++;
  await rejectUnchanged(f,s.update(update('claim',a.key,'claim-1','different reason')),/operation-conflict/);
  await rejectUnchanged(f,s.update(update('forfeit',a.key,'forfeit-claimed')),/winner-already-handled/);
  await s.update(update('forfeit',b.key,'forfeit-1'));await s.update(update('replace',b.key,'replace-1'));
  const record=f.m.rows.get(root+'/raffles/'+result.id),replacement=record.winners.at(-1);assert.equal(replacement.playerId,'p3');assert.equal(replacement.prizeName,b.prizeName);assert.equal(replacement.replaces,b.key);assert.equal(f.m.rows.get(ledger).winnerKeys.length,3);checks++;
  const beforeReplaceReplay=f.m.writes.length;assert.equal((await s.update(update('replace',b.key,'replace-1'))).replayed,true);assert.equal(f.m.writes.length,beforeReplaceReplay);checks++;
  await rejectUnchanged(f,s.update(update('replace',b.key,'replace-2')),/forfeit-first/);
  const concurrent=await Promise.allSettled([s.update(update('claim',replacement.key,'race-claim')),s.update(update('forfeit',replacement.key,'race-forfeit'))]);assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);assert.equal(concurrent.filter(x=>x.status==='rejected').length,1);checks++;
  assert(f.m.writes.every(w=>w.path===ledger||w.path===root+'/raffles/'+result.id||w.path==='tournamentActivity/'+code||w.path.startsWith(root+'/operationLog/')));checks++;
 }
 for(const bucket of [false,true]){
  const f=fixture({bucket}),{s,payload}=await prepare(f);
  const values=await Promise.all([s.draw(request(payload)),s.draw(request(payload))]);assert.equal(values.filter(x=>x.replayed).length,1);assert.equal(f.m.writes.filter(w=>w.kind==='create'&&w.path===root+'/raffles/draw-1').length,1);checks++;
  const old=f.m.rows.get(pub);f.m.remove(pub);f.m.put(pub,old);await rejectUnchanged(f,s.draw(request(payload)),/room-generation-changed/);
 }
 for(const mutate of [
  f=>f.m.put('users/admin',{active:true,role:'player'}),
  f=>f.m.put(root,{...f.m.rows.get(root),systemClosed:true}),
  f=>f.m.put(ledger,{identityVersion:'participant-v1',winnerKeys:['uid:u1']}),
 ]){const f=fixture(),{s,payload}=await prepare(f);mutate(f);await rejectUnchanged(f,s.draw(request(payload)));}
 {const f=fixture(),{s,payload}=await prepare(f);await rejectUnchanged(f,s.draw(request({...payload,candidateHash:'stale'})),/candidate-list-changed/);}
 {const f=fixture(),{s,payload}=await prepare(f);const made=await s.draw(request(payload));f.m.remove(ledger);await rejectUnchanged(f,s.draw(request(payload)),/raffle-record-invalid/);assert(made.winners.length===2);}
 {const f=fixture({bucket:false});f.m.put(ledger,{winnerKeys:[]});const {s,payload,preview}=await prepare(f);assert(preview.candidates.every(p=>p.key.startsWith('uid:')));const made=await s.draw(request(payload));assert.equal(made.identityVersion,'legacy');checks++;
  const p=root+'/raffles/'+made.id,record={...f.m.rows.get(p)};for(const field of ['identityVersion','sourcePublicCreatedAt','sourceBucketEpoch','candidateHash'])delete record[field];f.m.put(p,record);f.m.put(ledger,{winnerKeys:made.winners.map(w=>w.key)});
  assert.equal((await s.draw(request(payload))).replayed,true);await s.update(request({raffleId:made.id,operationId:'old-claim',action:'claim',winnerKey:made.winners[0].key}));assert.equal(f.m.rows.get(p).winners[0].status,'claimed');checks++;
 }
 {const f=fixture(),bad=services(f,{select:()=>[{key:'fake',playerId:'fake',name:'fake'},{key:'fake2',playerId:'fake2',name:'fake2'}]}),{payload}=await prepare(f,bad);await rejectUnchanged(f,bad.draw(request(payload)),/raffle-selection-invalid/);}
 {const f=fixture(),{s,payload}=await prepare(f);await s.draw(request(payload));const top=f.m.rows.get(root);f.m.remove(root);f.m.put(root,top);await rejectUnchanged(f,s.draw(request(payload)));}
 for(const mutate of [
  f=>{const d={...f.m.rows.get(ledger)};delete d.sourcePublicCreatedAt;f.m.put(ledger,d);},
  f=>{const p=root+'/raffles/draw-1';f.m.put(p,{...f.m.rows.get(p),identityVersion:'legacy'});},
  f=>{const p=root+'/raffles/draw-1';f.m.put(p,{...f.m.rows.get(p),sourceBucketEpoch:'different'});},
  f=>{const p=root+'/raffles/draw-1',d=structuredClone(f.m.rows.get(p));d.candidates[0].name='tampered';f.m.put(p,d);},
 ]){const f=fixture(),{s,payload}=await prepare(f);await s.draw(request(payload));mutate(f);await rejectUnchanged(f,s.draw(request(payload)));}
 {const f=fixture(),{s,payload}=await prepare(f);await s.draw(request(payload));f.m.put(root,{...f.m.rows.get(root),systemClosed:true});const writes=f.m.writes.length;assert.equal((await s.draw(request(payload))).replayed,true);assert.equal(f.m.writes.length,writes);checks++;}
 console.log(JSON.stringify({raffleWriterChecks:checks,productionWrites:0,callableWired:false,existingDrawsMigrated:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
