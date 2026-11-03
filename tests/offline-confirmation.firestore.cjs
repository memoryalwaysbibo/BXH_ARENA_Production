'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test,before,after}=require('node:test');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8091')throw Error('Dedicated local emulator required');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {createEngine}=require('../referee-seats/functions/engine/index.cjs');
const cloud=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8'),core=fs.readFileSync('modules/main-app/core.js','utf8');
let app,db,serial=0;
before(()=>{app=initializeApp({projectId:'demo-offline-confirmation-fix'},'offline-fix');db=getFirestore(app);});
after(async()=>{await db.terminate();await deleteApp(app);});
function helper(name){const a=cloud.indexOf('  function '+name+'('),b=cloud.indexOf('\n  function ',a+4);assert(a>=0&&b>a,name);return cloud.slice(a,b);}
function method(name){const a=cloud.indexOf('    async '+name+'('),b=cloud.indexOf('\n    },',a);assert(a>=0&&b>a);return cloud.slice(a,b+6);}
async function fixture(source){
 const code='BXH-OFFIX'+(++serial),ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const match={id:'m',seq:0,bracket:'SE',round:0,indexInRound:0,station:1,a:{playerId:'a'},b:{playerId:'b'},scoreA:0,scoreB:0,log:[],faultActions:[],completed:false,status:'in_progress'};
 const state={id:code,cloudCode:code,meta:{formatType:'single',stations:1,eventAuthority:'official'},bracketSize:2,startedAt:1,players:[{id:'a',name:'A'},{id:'b',name:'B'}],matches:[match],archiveStatus:'ongoing'};
 await ref.set({data:JSON.stringify(state),updatedAt:1,eventAuthority:'official'});await pub.set({bracketView:JSON.stringify(state),updatedAt:1});await db.doc('users/ref').set({active:true,role:'staff'});
 let lose=true;const writes=[];
 const fx={doc:(_db,...parts)=>db.doc(parts.join('/')),runTransaction:async(_db,fn)=>{
  const result=await db.runTransaction(async tx=>await fn({get:async r=>{const s=await tx.get(r);return {exists:()=>s.exists,data:()=>s.data()};},set:(...args)=>{writes.push(args[0].path);return tx.set(...args);}}));
  if(lose){lose=false;throw Error('lost-ack');}return result;
 }};
 const ctx={window:{addEventListener(){}},document:{addEventListener(){}},setTimeout(){},clearTimeout(){},setInterval(){},console,Date,Number,crypto:require('node:crypto').webcrypto,fx,cloudEnabled:true,dbHandle:db,authHandle:{currentUser:{uid:'ref'}},USERS_COLLECTION:'users',userProfile:{active:true,role:'staff'},currentAuthUid:()=> 'ref',communityRoomExpiryMs:()=>null,computeTournamentPhase:()=> 'live',buildPublicEventInfo:()=>({})};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('offline-resilience.js','utf8'),ctx);
 for(const name of ['courtLifecycleWritePatch','advanceOnsiteWriteFence','buildPublicMirrorFields'])vm.runInContext(helper(name),ctx);
 vm.runInContext('window.cloudSync={'+method('confirmMatchTransaction')+'};',ctx);
 const engine=s=>createEngine(s,{uid:'ref',name:'Ref'},Date.now(),'offline-fix');
 ctx.rebuildPropagationForState=s=>engine(s).rebuildPropagationForState(s);
 ctx.evaluateMatchCompletion=m=>engine(state).evaluateMatchCompletion(m);
 ctx.evaluateQuickDecision=(m,id)=>engine(state).evaluateQuickDecision(m,id);
 ctx.applyMatchCompletionFields=(m,e,actor)=>engine(state).applyMatchCompletionFields(m,e,actor);
 ctx.applyQuickDecisionFields=(m,e,actor)=>engine(state).applyQuickDecisionFields(m,e,actor);
 const start=source.indexOf('window.BXHCommitOfflineMatch=async function(op){'),end=source.indexOf('window.addEventListener("bxh-offline-operation-synced"',start);assert(start>=0&&end>start);vm.runInContext(source.slice(start,end),ctx);
 const scoringMatch=JSON.parse(JSON.stringify(match));
 const events=[engine(state).createHunterRoundEvent(scoringMatch,'A','knockout',2,100),engine(state).createHunterRoundEvent(scoringMatch,'A','knockout',2,101)];
 const op={id:'offline-op-example-001',actorUid:'ref',actorName:'Ref',tournamentCode:code,matchId:'m',station:1,dispatchRevision:0,playerAId:'a',playerBId:'b',mode:'score',selectedWinnerId:'a',scoreA:4,scoreB:0,log:events,faultActions:[],auditMeta:{recordDuty:true,uid:'ref',matchId:'m',station:1,dispatchRevision:0}};
 return {ctx,op,ref,pub,writes,run:op=>ctx.window.BXHCommitOfflineMatch(op)};
}
for(const [name,source] of [['core',core],['cloud runtime',cloud]])test(name+' bridge: lost acknowledgement recovers without another score, mirror or duty-log write',{timeout:20000},async()=>{
 const f=await fixture(source),first=await f.run(f.op);console.log(name,'first outcome',JSON.stringify(first));assert.equal(first.ok,false);assert.equal(first.reason,'lost-ack');
 const before=(await f.ref.get()).data(),publicBefore=(await f.pub.get()).data(),duties=(await db.doc('staffActivityLogs/ref/matches/'+f.op.tournamentCode+'_m').get()).data(),writes=f.writes.length;
 assert.equal(JSON.parse(before.data).matches[0].winnerId,'a');assert(!publicBefore.bracketView.includes('offlineConfirmationReceipt'));
 const recovered=await f.run(f.op);assert.equal(recovered.ok,true);assert.equal(recovered.alreadyApplied,true);assert.equal(f.writes.length,writes);
 assert.deepEqual((await f.ref.get()).data(),before);assert.deepEqual((await f.pub.get()).data(),publicBefore);assert.deepEqual((await db.doc('staffActivityLogs/ref/matches/'+f.op.tournamentCode+'_m').get()).data(),duties);
 for(const patch of [{id:'another-operation'},{scoreA:5},{selectedWinnerId:'b'},{playerAId:'other'},{dispatchRevision:1},{actorUid:'other'}]){const r=await f.run({...f.op,...patch});assert.equal(r.ok,false);assert.equal(f.writes.length,writes);}
});
