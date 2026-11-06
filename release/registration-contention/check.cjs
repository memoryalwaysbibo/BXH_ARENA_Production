'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8196');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration40');
const {initializeApp}=require('firebase-admin/app');
initializeApp({projectId:process.env.GCLOUD_PROJECT});
const fixture=require('./live-source-20261105.json');
for(const [file,digest]of Object.entries(fixture.files))assert.equal(crypto.createHash('sha256').update(fixture.blobs[digest]).digest('hex'),digest,file);
function handler(candidate,metrics,{clock=Date.now,admissionOptions,beforeTransaction}={}){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const source=candidate&&['family-registration.js','registration-admission.cjs'].includes(file)?fs.readFileSync(path.join(__dirname,'candidate',file),'utf8'):fixture.blobs[fixture.files[file]];
  assert(source,file);const module={exports:{}};cache.set(file,module);
  new Function('require','module','exports',source)(name=>name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+(/\.(?:js|cjs)$/.test(name)?'':'.js')):require(name),module,module.exports);
  if(candidate&&file==='registration-admission.cjs'&&admissionOptions){const original=module.exports.createAdmission;module.exports.createAdmission=options=>original({...options,...admissionOptions});}
  return module.exports;
 }
 const native=load('_qr_checkin/admin-firestore.cjs').getFirestore();
 const db=new Proxy(native,{get(target,key){
  if(key==='runTransaction')return async(callback,options)=>{
   const start=performance.now();let attempts=0;
   try{if(beforeTransaction)await beforeTransaction(options);return await target.runTransaction(async tx=>{attempts++;return callback(tx);},options);}
   finally{metrics.push({readOnly:options?.readOnly===true,attempts,ms:performance.now()-start});}
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const factory=()=>load('family-registration.js').createFamilyRegistration(db,clock,{myEventsProofEnabled:true});
 return {db:native,call:factory(),newFactory:factory};
}
let serial=0;const runId=crypto.randomBytes(3).toString('hex').toUpperCase();
async function seed(db,count,capacity=64,waitlistCapacity=16){
 const code='BXH-C'+runId+String(++serial).padStart(6,'0'),now=Date.now();
 const room={capacity,waitlistEnabled:true,waitlistCapacity,confirmedCount:0,waitlistCount:0,tournamentPhase:'waiting',registrationEnabled:true,registrationVisibility:'public',visibility:'public',publishedAt:now-1000,registrationOpenAt:now-1000,registrationCloseAt:now+3600000,cancellationDeadline:now+3600000,data:JSON.stringify({meta:{},players:[]})};
 const batch=db.batch();batch.set(db.doc('tournaments/'+code),room);batch.set(db.doc('publicTournaments/'+code),room);
 const ids=Array.from({length:count},(_,i)=>'synthetic-'+code+'-'+i);
 for(const uid of ids)batch.set(db.doc('users/'+uid),{active:true,role:'player',realName:'Synthetic '+uid,phone:'0000000000',profileCompleted:true});
 await batch.commit();return {code,ids};
}
async function audit(db,code,expected){
 const [t,p,registrations]=await Promise.all([db.doc('tournaments/'+code).get(),db.doc('publicTournaments/'+code).get(),db.collection('tournaments/'+code+'/registrations').get()]);
 for(const [field,status]of [['confirmedCount','confirmed'],['waitlistCount','waitlist']]){
  const n=registrations.docs.filter(d=>d.data().status===status).length;
  assert.equal(t.data()[field],n);assert.equal(p.data()[field],n);
 }
 assert(t.data().confirmedCount<=t.data().capacity);assert(t.data().waitlistCount<=t.data().waitlistCapacity);
 if(expected!==undefined)assert.equal(registrations.docs.filter(d=>['confirmed','waitlist'].includes(d.data().status)).length,expected);
 return {confirmed:t.data().confirmedCount,waitlist:t.data().waitlistCount,documents:registrations.size};
}
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]||0;
async function wave(candidate,count,capacity=64,waitlistCapacity=16,instances=1){
 const metrics=[],services=Array.from({length:instances},()=>handler(candidate,metrics)),{db}=services[0],{code,ids}=await seed(db,count,capacity,waitlistCapacity),timings=[];
 const start=performance.now();
 const results=await Promise.allSettled(ids.map(async(uid,i)=>{
  const begun=performance.now(),{call}=services[i%instances];
  try{
   const preview=await call({auth:{uid},data:{action:'preview',code,childIds:[null],childEligibilityConfirmed:true}});
   const request={action:'join',code,childIds:[null],childEligibilityConfirmed:true,allocation:preview.allocation,operationId:'wave-'+serial+'-'+i};
   return await call({auth:{uid},data:request});
  }finally{timings.push(performance.now()-begun);}
 }));
 const failed=results.filter(x=>x.status==='rejected').map(x=>String(x.reason?.message||x.reason));
 const succeeded=count-failed.length,counts=await audit(db,code,succeeded);
 const summary={candidate,instances,count,capacity,waitlistCapacity,succeeded,failed,counts,totalMs:Math.round(performance.now()-start),p50Ms:Math.round(percentile(timings,.5)),p95Ms:Math.round(percentile(timings,.95)),maxMs:Math.round(Math.max(...timings)),transactions:metrics.length,retries:metrics.reduce((n,x)=>n+x.attempts-1,0),readOnlyTransactions:metrics.filter(x=>x.readOnly).length};
 console.log(JSON.stringify(summary));return summary;
}
async function semantics(){
 const metrics=[],{db,call}=handler(true,metrics),{code,ids:[uid]}=await seed(db,1),req={auth:{uid},data:{action:'join',code,childIds:[null],childEligibilityConfirmed:true,operationId:'same-operation-123'}};
 const [a,b]=await Promise.all([call(req),call(req)]);assert(a.ok&&b.ok);await audit(db,code,1);
 await assert.rejects(call({...req,data:{...req.data,childEligibilityConfirmed:false}}),/operation-conflict/);
 const mine=await call({auth:{uid},data:{action:'mine',code}});assert.equal(mine.rows.length,1);assert.equal(mine.rows[0].status,'confirmed');
 await call({auth:{uid},data:{action:'cancel',code,operationId:'cancel-operation-123'}});await audit(db,code,0);
 const replay=await call(req);assert.equal(replay.replayed,true);const current=await call({auth:{uid},data:{action:'mine',code}});assert.equal(current.rows[0].status,'cancelled');
 const {code:other}=await seed(db,1);await db.doc('users/'+uid).update({active:false});
 await assert.rejects(call({auth:{uid},data:{action:'preview',code:other,childIds:[null]}}),/auth-required/);
 const {code:limited,ids:[one,two,three]}=await seed(db,3,1,1);
 for(const [i,person]of [one,two].entries()){
  const preview=await call({auth:{uid:person},data:{action:'preview',code:limited,childIds:[null],childEligibilityConfirmed:true}});
  assert.equal(preview.rows[0].status,i?'waitlist':'confirmed');
  const result=await call({auth:{uid:person},data:{action:'join',code:limited,childIds:[null],childEligibilityConfirmed:true,allocation:preview.allocation,operationId:'limited-person-'+i}});
  assert.equal(result.status,i?'waitlist':'confirmed');
 }
 await assert.rejects(call({auth:{uid:three},data:{action:'preview',code:limited,childIds:[null]}}),/full/);await audit(db,limited,2);
 const {code:family,ids:[parent]}=await seed(db,1);
 await db.doc('familyPlayers/'+parent).set({profiles:[{id:'kid1',guardianUid:parent,name:'Synthetic child 1',nickname:'',playerId:'CHILD001',displayCode:'P001C1'},{id:'kid2',guardianUid:parent,name:'Synthetic child 2',nickname:'',playerId:'CHILD002',displayCode:'P001C2'}]});
 const children=[null,'kid1','kid2'];
 const preview=await call({auth:{uid:parent},data:{action:'preview',code:family,childIds:children,childEligibilityConfirmed:true}});await audit(db,family,0);
 assert.equal((await db.collection('familyPlayers/'+parent+'/registrationActions').get()).size,0);
 const joined=await call({auth:{uid:parent},data:{action:'join',code:family,childIds:children,childEligibilityConfirmed:true,allocation:preview.allocation,operationId:'family-all-three'}});assert.equal(joined.rows.length,3);await audit(db,family,3);
 for(const id of ['family_kid1','family_kid2']){
  const row=(await db.doc('tournaments/'+family+'/registrations/'+id).get()).data();assert.equal(row.guardianUid,parent);assert.equal(row.ladderEligible,false);assert.equal(row.activityEligible,false);
 }
 console.log(JSON.stringify({semantics:'PASS',sameOperationUnique:true,currentCancellationPreserved:true,inactiveDenied:true}));
}
module.exports={wave,semantics,handler,seed,audit,sourceGeneration:fixture.sourceGeneration};
if(require.main===module)(async()=>{
 const results=[];
 // Alternate order to make warmup effects visible. Emulator timings are not cloud latency.
 for(const n of process.env.CANDIDATE_ONLY?[]:[1,10,40]){results.push(await wave(false,n));results.push(await wave(true,n));}
 if(!process.env.SEMANTICS_ONLY){
  results.push(await wave(true,40));
  results.push(await wave(true,40,64,16,5));
  results.push(await wave(true,40,24,8));
 }
 await semantics();
 fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify({capturedSource:fixture.sourceGeneration,scope:'Firestore Emulator; synthetic Auth; not live capacity',results},null,2)+'\n');
 for(const result of results.filter(x=>x.candidate)){
  if(result.capacity>=result.count)assert.equal(result.succeeded,result.count,'candidate capacity case failed');
  else assert(result.failed.every(x=>/full|allocation-changed/.test(x)),JSON.stringify(result.failed));
 }
 await require('firebase-admin/firestore').getFirestore().terminate();
})().catch(error=>{console.error(error);process.exitCode=1;});
