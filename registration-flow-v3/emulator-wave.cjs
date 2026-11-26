'use strict';
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {fork}=require('node:child_process');
const {createHoldService}=require('./hold-service.cjs');
const {createAuthorizers}=require('./permissions.cjs');
const {createAdmission}=require('./admission.cjs');
const {createSummarySync}=require('./summary-sync.cjs');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration-v3');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:process.env.GCLOUD_PROJECT}));
const metrics=[];
const workerMode=process.argv[2]==='worker';
const instances=Number(process.env.BXH_WAVE_INSTANCES||1);
assert(Number.isSafeInteger(instances)&&instances>=1&&instances<=16);
const services=Array.from({length:instances},()=>createHoldService({db,...createAuthorizers({db}),admit:createAdmission(),observe:m=>metrics.push(m)}));
async function main(){
 const code='BXH-'+randomBytes(5).toString('hex').toUpperCase(),room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const now=Date.now(),capacity=192,run=code.slice(4),ids=Array.from({length:193},(_,i)=>run+'-'+i);
 const common={registrationFlowVersion:3,capacity,tournamentPhase:'waiting',registrationEnabled:true,visibility:'public',registrationVisibility:'public',publishedAt:now-1000,registrationOpenAt:now-1000,registrationCloseAt:now+3600000,cancellationDeadline:now+3600000};
 const batch=db.batch();
 batch.set(room,{...common,data:JSON.stringify({meta:{},players:[],matches:[]})});
 batch.set(pub,{...common,bracketView:JSON.stringify({meta:{},players:[],matches:[]})});
 batch.set(room.collection('registrationV3State').doc('ledger'),{capacity,occupiedCount:0,pendingReviewCount:0,confirmedCount:0,sequence:0,revision:0});
 for(const uid of ids)batch.set(db.doc('users/'+uid),{active:true,role:'player',realName:'Synthetic',phone:'000',profileCompleted:true});
 await batch.commit();
 const join=uid=>services[Number(uid.split('-').at(-1))%instances]({auth:{uid},data:{code,action:'join',operationId:'join-'+uid}});
 const concurrency=Number(process.env.BXH_WAVE_CONCURRENCY||193);
 assert(Number.isSafeInteger(concurrency)&&concurrency>0&&concurrency<=193);
 const actualProcesses=process.env.BXH_WAVE_PROCESSES==='1';
 const begin=performance.now(),results=[];
 if(actualProcesses){
  assert.equal(concurrency,193);
  const workers=Array.from({length:instances},(_,i)=>new Promise((resolve,reject)=>{
   const child=fork(__filename,['worker'],{env:{...process.env,BXH_WAVE_INSTANCES:'1'},stdio:['ignore','ignore','inherit','ipc']});
   child.once('error',reject);
   child.once('exit',status=>{if(status)reject(Error('worker-exit-'+status));});
   child.on('message',m=>{if(m.type==='ready')child.send({code,ids:ids.filter((_,n)=>n%instances===i)});else if(m.type==='result')resolve(m);});
  }));
  const groups=await Promise.all(workers);
  for(const g of groups){results.push(...g.results);metrics.push(...g.metrics);}
 }else for(let i=0;i<ids.length;i+=concurrency)results.push(...await Promise.allSettled(ids.slice(i,i+concurrency).map(join)));
 const elapsedMs=performance.now()-begin;
 const ledger=(await room.collection('registrationV3State').doc('ledger').get()).data();
 const rows=await room.collection('registrationV3Holds').get();
 const success=results.filter(x=>x.status==='fulfilled').length;
 const errors={};for(const x of results.filter(x=>x.status==='rejected')){const k=String(x.reason.code||x.reason.message).slice(0,120);errors[k]=(errors[k]||0)+1;}
 assert.equal(ledger.occupiedCount,rows.size);assert.equal(success,rows.size);assert(ledger.occupiedCount<=capacity);
 assert.equal(new Set(rows.docs.map(d=>d.data().sequence)).size,rows.size);
 const percentile=(arr,p)=>arr.sort((a,b)=>a-b)[Math.min(arr.length-1,Math.ceil(arr.length*p)-1)]??null;
 const report={capacity,concurrency,instances,actualProcesses,submitted:ids.length,success,errors,elapsedMs,ledger,metrics:{reads:metrics.reduce((a,m)=>a+m.reads,0),committedWrites:metrics.reduce((a,m)=>a+m.committedWrites,0),attempts:metrics.reduce((a,m)=>a+m.attempts,0),p50Ms:percentile(metrics.map(m=>m.elapsedMs),.5),p95Ms:percentile(metrics.map(m=>m.elapsedMs),.95)}};
 console.log(JSON.stringify(report,null,2));
 if(success!==capacity)process.exitCode=1;
}
if(workerMode){
 process.once('message',async m=>{
  const results=await Promise.allSettled(m.ids.map(uid=>services[0]({auth:{uid},data:{code:m.code,action:'join',operationId:'join-'+uid}})));
  const safe=results.map(x=>x.status==='fulfilled'?x:{status:'rejected',reason:{code:x.reason.code,message:x.reason.message}});
  await db.terminate();
  process.send({type:'result',results:safe,metrics},()=>process.disconnect());
 });
 process.send({type:'ready'});
}else main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.terminate());
