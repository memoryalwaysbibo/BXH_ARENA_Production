'use strict';
const assert=require('node:assert/strict');
const core=require('../operations/fixtures/5/operations-core.js');
const {fixture,code}=require('../completion/fixture.cjs');
const {participantKey:key,participantPool:pool}=require('../../../release/buckets/raffle/identity.cjs');
const {createRaffleInput}=require('../../../release/buckets/raffle/input.cjs');
const state=()=>({meta:{formatType:'single'},players:[{id:'parent',registrationUid:'shared',name:'同名玩家',checkedIn:true},{id:'child',registrationUid:'shared',name:'同名玩家',checkedIn:true}],matches:[]});
let checks=0;
function check(fn){fn();checks++;}
check(()=>{const s=state();assert.equal(core.candidates(s,'general').length,1);const before=JSON.stringify(s);assert.equal(pool(core,s,'general').length,2);assert.equal(JSON.stringify(s),before);});
check(()=>{const s=state(),winner=pool(core,s,'general')[0];assert.equal(pool(core,s,'general',[winner.key]).length,1);assert.notEqual(pool(core,s,'general',[winner.key])[0].playerId,winner.playerId);});
check(()=>{const s=state(),before=pool(core,s,'general');s.players[0].name='改名';s.players.reverse();assert.deepEqual(pool(core,s,'general').map(x=>x.key),before.map(x=>x.key));assert.equal(pool(core,s,'general',[before[0].key]).length,1);});
check(()=>{const s=state();s.players.pop();const original=pool(core,s,'general')[0].key;s.players.push({...s.players[0],id:'child'});assert(pool(core,s,'general').some(x=>x.key===original));});
check(()=>{const s=state();s.entryCandidates=[structuredClone(s.players[0]),{id:'onsite',name:'同名玩家',checkedIn:true}];assert.equal(pool(core,s,'general').length,3);});
check(()=>{const s=state();s.players.push({...s.players[0]});assert.equal(pool(core,s,'general').length,2);});
check(()=>{const s=state();s.players[1].registrationUid='another';assert.equal(pool(core,s,'general').length,2);});
check(()=>{const s=state();delete s.players[1].checkedIn;assert.equal(pool(core,s,'general').length,1);s.players[1].checkedIn=true;s.players[1].withdrawn=true;assert.equal(pool(core,s,'general').length,1);});
check(()=>{const s=state();s.matches=[{bracket:'SE',round:0,completed:true,a:{playerId:'parent'},b:{playerId:'child'},winnerId:'parent',loserId:'child'}];assert.deepEqual(pool(core,s,'first_round').map(x=>x.playerId),['child']);});
check(()=>{for(const old of ['uid:shared','onsite:parent','participant:v1:bad'])assert.throws(()=>pool(core,state(),'general',[old]),/raffle-exclusion-identity-version/);});
check(()=>{const s=state(),winner=key(s.players[0]);s.players[0].registrationUid='transferred';assert.throws(()=>pool(core,s,'general',[winner]),/raffle-participant-identity-changed/);});
check(()=>{const s=state();s.players.push({...s.players[0],registrationUid:'different'});assert.throws(()=>pool(core,s,'general'),/raffle-player-id-conflict/);});
check(()=>{for(const id of [undefined,'',3]){const s=state();s.players[0].id=id;assert.throws(()=>pool(core,s,'general'),/raffle-player-id-required/);}});
check(()=>{assert.notEqual(key({id:'a:b',uid:'c'}),key({id:'b',uid:'c:a'}));assert.equal(key({id:'onsite'}),key({id:'onsite',name:'改名'}));});
check(()=>{assert.throws(()=>createRaffleInput(core,{identityVersion:'name'}),/raffle-identity-version/);});
(async()=>{
 for(const bucket of [false,true]){
  const f=fixture({bucket}),path='tournaments/'+code,top=f.m.rows.get(path),s=JSON.parse(top.data);
  s.players[1].registrationUid=s.players[0].registrationUid;s.players[1].name=s.players[0].name;f.m.put(path,{...top,data:JSON.stringify(s)});
  const read=createRaffleInput(core,{identityVersion:'participant-v1'}),observed={},before=JSON.stringify([...f.m.rows]);
  const result=await f.m.db.runTransaction(async tx=>{const[root,pub]=await tx.getAll(f.m.db.doc(path),f.m.db.doc('publicTournaments/'+code));return read({db:f.m.db,tx,root,pub,code,mode:'general',observed});});
  assert.equal(result.pool.length,4);assert.equal(result.candidateHash,core.poolHash(result.pool));assert.equal(JSON.stringify([...f.m.rows]),before);assert.equal(f.m.writes.length,0);checks++;
  const oldRead=createRaffleInput(core);
  await assert.rejects(f.m.db.runTransaction(async tx=>{const[root,pub]=await tx.getAll(f.m.db.doc(path),f.m.db.doc('publicTournaments/'+code));return oldRead({db:f.m.db,tx,root,pub,code,mode:'general',observed});}),/raffle-room-changed/);checks++;
 }
 console.log(JSON.stringify({participantIdentityChecks:checks,productionWrites:0,callableWired:false,existingDrawsMigrated:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
