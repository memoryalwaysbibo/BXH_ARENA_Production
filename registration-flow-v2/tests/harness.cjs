'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8197');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration-v2');
const {initializeApp}=require('firebase-admin/app');
initializeApp({projectId:process.env.GCLOUD_PROJECT});
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const db=getFirestore();
const fixture=require('./captured-family-source.json'),cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const digest=fixture.files[file],source=fixture.blobs[digest];assert(source,file);
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),digest,file);
 const module={exports:{}};cache.set(file,module);
 new Function('require','module','exports',source)(name=>name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+(/\.(?:js|cjs)$/.test(name)?'':'.js')):require(name),module,module.exports);
 return module.exports;
}
const familyFactory=load('family-registration.js').createFamilyRegistration;
// This roster implementation is a repository overlay, NOT a fresh production
// capture. Release is blocked until both writer sources are independently read back.
const rosterFactory=require('../../qr-checkin/backend/overlays/roster-service.js').createRosterService;
const handlers={family:store=>familyFactory(store,Date.now,{myEventsProofEnabled:true}),roster:store=>rosterFactory(store,FieldValue)};
const {createQueue}=require('../backend/queue.cjs');
function service(options={}){return createQueue(db,{handlers,FieldValue,...options});}
let serial=0;const prefix=crypto.randomBytes(3).toString('hex').toUpperCase();
async function seed(count,capacity=count,waitlistCapacity=0){
 const code='BXH-Q'+prefix+String(++serial).padStart(4,'0'),now=Date.now();
 const room={capacity,waitlistEnabled:waitlistCapacity>0,waitlistCapacity,confirmedCount:0,waitlistCount:0,tournamentPhase:'waiting',registrationEnabled:true,registrationVisibility:'public',visibility:'public',publishedAt:now-1000,registrationOpenAt:now-1000,registrationCloseAt:now+3600000,cancellationDeadline:now+3600000,registrationStatus:'open',data:JSON.stringify({meta:{registrationAutoFillEnabled:true},players:[],waitlistPlayers:[]}),bracketView:JSON.stringify({meta:{},players:[]})};
 const batch=db.batch();batch.set(db.doc('tournaments/'+code),room);batch.set(db.doc('publicTournaments/'+code),room);
 const ids=Array.from({length:count},(_,i)=>'synthetic-'+code+'-'+i);
 for(const uid of ids)batch.set(db.doc('users/'+uid),{active:true,role:'player',realName:'Synthetic',phone:'0000000000',profileCompleted:true});
 await batch.commit();return {code,ids};
}
function request(code,uid,operationId='join-'+uid){return {code,route:'family',operationId,payload:{action:'join',code,childIds:[null],childEligibilityConfirmed:true,operationId}};}
async function audit(code,expected){
 const [t,p,r,j]=await Promise.all([db.doc('tournaments/'+code).get(),db.doc('publicTournaments/'+code).get(),db.collection('tournaments/'+code+'/registrations').get(),db.collection('_registrationQueueV2/'+code+'/_registrationQueueJobsV2').get()]);
 for(const [field,status]of [['confirmedCount','confirmed'],['waitlistCount','waitlist']]){
  const n=r.docs.filter(d=>d.data().status===status).length;
  assert.equal(t.data()[field],n);assert.equal(p.data()[field],n);
 }
 assert(t.data().confirmedCount<=t.data().capacity);assert(t.data().waitlistCount<=t.data().waitlistCapacity);
 if(expected!==undefined)assert.equal(r.docs.filter(d=>['confirmed','waitlist'].includes(d.data().status)).length,expected);
 const summary={confirmed:t.data().confirmedCount,waitlist:t.data().waitlistCount,registrations:r.size,jobs:j.size,completed:j.docs.filter(d=>d.data().state==='completed').length,rejected:j.docs.filter(d=>d.data().state==='rejected').length};
 return {summary,rows:r.docs.map(d=>({id:d.id,...d.data()})),jobs:j.docs.map(d=>({id:d.id,...d.data()}))};
}
async function drainAll(services,code){
 for(let rounds=0;rounds<100;rounds++){
  const unfinished=await db.collection('_registrationQueueV2/'+code+'/_registrationQueueJobsV2').where('state','in',['queued','running']).get();
  if(unfinished.empty)return;
  await Promise.all(services.map(s=>s.drain(code,{limit:200,budgetMs:20000})));
 }
 throw Error('queue-did-not-drain');
}
module.exports={db,FieldValue,handlers,service,seed,request,audit,drainAll};
