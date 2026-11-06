'use strict';
const assert=require('node:assert/strict');
const {fixture,code,NOW}=require('../completion/fixture.cjs');
const core=require('../operations/fixtures/5/operations-core.js');
const {participantKey}=require('../../../release/buckets/raffle/identity.cjs');
const {createRafflePreview}=require('../../../release/buckets/raffle/preview.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const root='tournaments/'+code,ledger=root+'/raffleControl/current';
const request=(overrides={})=>({auth:{uid:'admin'},data:{code:code.toLowerCase(),mode:'general',...overrides}});
const create=(f,db=f.m.db)=>createRafflePreview({db,core,HttpsError,now:()=>NOW});
function family(f){const top=f.m.rows.get(root),s=JSON.parse(top.data);s.players[1].registrationUid=s.players[0].registrationUid;s.players[1].name=s.players[0].name;f.m.put(root,{...top,data:JSON.stringify(s)});return s;}
(async()=>{let checks=0;
 for(const bucket of [false,true]){
  const f=fixture({bucket}),s=family(f),before=JSON.stringify([...f.m.rows]);
  const value=await create(f)(request());assert.equal(value.count,4);assert.equal(value.candidateHash,core.poolHash(value.candidates));assert.equal(JSON.stringify([...f.m.rows]),before);assert.equal(f.m.writes.length,0);checks++;
  f.m.put(ledger,{winnerKeys:['uid:u1']});assert.equal((await create(f)(request())).count,2);checks++;
  f.m.put(ledger,{identityVersion:'participant-v1',sourceCreatedAt:String(f.m.snapshot(root).createTime.seconds)+':0',winnerKeys:[participantKey(s.players[0])]});
  const value2=await create(f)(request());assert.equal(value2.count,3);assert(value2.candidates.some(x=>x.playerId==='p2'));assert(!value2.candidates.some(x=>x.playerId==='p1'));checks++;
  assert.equal((await create(f)(request({excludePrevious:false}))).count,4);checks++;
 }
 for(const change of [
  f=>f.m.remove('users/admin'),
  f=>f.m.put('users/admin',{active:false,role:'super_admin'}),
  f=>f.m.put('users/admin',{active:true,role:'player'}),
  f=>f.m.put(root,{...f.top,systemClosed:true}),
  f=>f.m.put(ledger,{identityVersion:'player-name',winnerKeys:[]}),
  f=>f.m.put(ledger,{identityVersion:'participant-v1',winnerKeys:['uid:u1']}),
  f=>f.m.put(ledger,{winnerKeys:[],sourceCreatedAt:'other-room'}),
  f=>f.m.put(ledger,{winnerKeys:'not-an-array'}),
 ]){const f=fixture();change(f);const before=JSON.stringify([...f.m.rows]);await assert.rejects(create(f)(request()));assert.equal(JSON.stringify([...f.m.rows]),before);assert.equal(f.m.writes.length,0);checks++;}
 {const f=fixture();await assert.rejects(create(f)({data:{code,mode:'general'}}),e=>e.code==='unauthenticated');await assert.rejects(create(f)(request({code:'bad/path'})),e=>e.code==='invalid-argument');checks++;}
 {const f=fixture();f.m.put(ledger,{identityVersion:'participant-v1',winnerKeys:['uid:u1']});await assert.rejects(create(f)(request({excludePrevious:false})),/raffle-exclusion-identity-version/);assert.equal(f.m.writes.length,0);checks++;}
 // A stale actor preflight must not authorize a transaction after role removal.
 {const f=fixture(),db={doc:f.m.db.doc,runTransaction:async cb=>{f.m.put('users/admin',{active:true,role:'player'});return f.m.db.runTransaction(cb);}};await assert.rejects(create(f,db)(request()),e=>e.code==='permission-denied');assert.equal(f.m.writes.length,0);checks++;}
 // Synthetic callback replay verifies the caller-owned observed ledger context.
 {const f=fixture(),db={doc:f.m.db.doc,runTransaction:async cb=>{await f.m.db.runTransaction(cb);f.m.put(ledger,{identityVersion:'participant-v1',winnerKeys:[]});return f.m.db.runTransaction(cb);}};await assert.rejects(create(f,db)(request()),/raffle-ledger-changed/);assert.equal(f.m.writes.length,0);checks++;}
 console.log(JSON.stringify({rafflePreviewChecks:checks,productionWrites:0,callableWired:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
