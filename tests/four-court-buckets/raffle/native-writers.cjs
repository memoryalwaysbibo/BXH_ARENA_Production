'use strict';
const assert=require('node:assert/strict');
const project='demo-bxh-bucket-raffle';
assert.equal(process.env.GCLOUD_PROJECT,project,'isolated demo project required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198','loopback emulator required');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {fixture,code,NOW}=require('../completion/fixture.cjs');
const core=require('../operations/fixtures/5/operations-core.js');
const {createRafflePreview}=require('../../../release/buckets/raffle/preview.cjs');
const {createRaffleWriters}=require('../../../release/buckets/raffle/writers.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const app=initializeApp({projectId:project}),db=getFirestore(app),root='tournaments/'+code,pub='publicTournaments/'+code,ledger=root+'/raffleControl/current';
const options={db,core,HttpsError,now:()=>NOW,select:(pool,count)=>core.draw(pool,count,(min,max)=>min)},preview=createRafflePreview(options),writers=createRaffleWriters(options);
const request=data=>({auth:{uid:'admin'},data:{code,mode:'general',...data}});
let checks=0;
async function seed(config){
 const response=await fetch('http://127.0.0.1:8198/emulator/v1/projects/'+project+'/databases/(default)/documents',{method:'DELETE'});assert.equal(response.status,200);
 const f=fixture(config),top=f.m.rows.get(root),state=JSON.parse(top.data);state.players[1].registrationUid=state.players[0].registrationUid;state.players[1].name=state.players[0].name;f.m.put(root,{...top,data:JSON.stringify(state)});
 const batch=db.batch();for(const [path,value] of f.m.rows)batch.set(db.doc(path),value);await batch.commit();
}
async function protectedState(){return JSON.stringify((await db.getAll(...[root,pub,...[1,2,3].map(i=>root+'/matchBuckets/court-'+i)].map(p=>db.doc(p)))).map(s=>[s.ref.path,s.data(),s.createTime]));}
(async()=>{try{
 for(const config of [{bucket:false},{bucket:true,courts:4},{bucket:true,courts:6},{bucket:true,courts:12}]){
  await seed(config);const before=await protectedState(),pool=await preview(request({}));assert.equal(pool.count,4);
  const payload={operationId:'native-draw',candidateHash:pool.candidateHash,prizes:[{name:'Prize A',quantity:1},{name:'Prize B',quantity:1}]};
  const duplicate=await Promise.allSettled([writers.draw(request(payload)),writers.draw(request(payload))]);
  assert(duplicate.every(x=>x.status==='fulfilled'),JSON.stringify(duplicate.map(x=>x.status==='rejected'?{error:x.reason.message,code:x.reason.code}:{replayed:x.value.replayed})));
  assert.equal(duplicate.filter(x=>x.value.replayed===true).length,1);assert.equal((await db.collection(root+'/raffles').get()).size,1);assert.equal((await db.collection(root+'/operationLog').where('type','==','raffle-draw').get()).size,1);checks++;
  const made=duplicate[0].value,a=made.winners[0],b=made.winners[1];assert.deepEqual(made.winners.map(w=>w.playerId),['p1','p2']);assert.equal(made.identityVersion,'participant-v1');assert.equal((await db.doc(ledger).get()).data().winnerKeys.length,2);checks++;
  const update=(action,key,operationId)=>request({raffleId:made.id,action,winnerKey:key,operationId,reason:'native demo reason'});
  await writers.update(update('forfeit',b.key,'native-forfeit'));await writers.update(update('replace',b.key,'native-replace'));
  let saved=(await db.doc(root+'/raffles/'+made.id).get()).data();const replacement=saved.winners.at(-1);assert.equal(replacement.playerId,'p3');assert.equal(replacement.prizeName,b.prizeName);assert.equal(replacement.replaces,b.key);assert.equal((await db.doc(ledger).get()).data().winnerKeys.length,3);checks++;
  const revision=saved.revision;assert.equal((await writers.update(update('replace',b.key,'native-replace'))).replayed,true);assert.equal((await db.doc(root+'/raffles/'+made.id).get()).data().revision,revision);checks++;
  const race=await Promise.allSettled([writers.update(update('claim',a.key,'native-claim')),writers.update(update('forfeit',a.key,'native-race-forfeit'))]);assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected').length,1);checks++;
  assert.equal(await protectedState(),before);checks++;
  const frozen=JSON.stringify((await db.doc(root+'/raffles/'+made.id).get()).data()),publicData=(await db.doc(pub).get()).data();await db.doc(pub).delete();await db.doc(pub).set(publicData);
  await assert.rejects(writers.draw(request(payload)),/room-generation-changed/);assert.equal(JSON.stringify((await db.doc(root+'/raffles/'+made.id).get()).data()),frozen);checks++;
 }
 await seed({bucket:true});const p=await preview(request({}));await assert.rejects(writers.draw(request({operationId:'bad-hash',title:'Test',count:1,candidateHash:'wrong'})),/candidate-list-changed/);assert.equal((await db.collection(root+'/raffles').get()).size,0);checks++;
 await db.doc(ledger).set({winnerKeys:[]});const legacy=await preview(request({}));assert.equal(legacy.count,3);const old=await writers.draw(request({operationId:'legacy-draw',title:'Legacy',count:1,candidateHash:legacy.candidateHash}));assert.equal(old.identityVersion,'legacy');assert(old.winners[0].key.startsWith('uid:'));checks++;
 console.log(JSON.stringify({nativeRaffleWriterChecks:checks,productionRequests:0,productionWrites:0,callableWired:false,scope:'isolated SDK transactions; fixture auth; controlled concurrency, no production acceptance'}));
 }finally{await db.terminate();await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1;});
