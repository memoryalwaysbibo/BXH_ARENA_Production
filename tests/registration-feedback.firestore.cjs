'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8093');assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration-feedback');
require('firebase-admin/app').initializeApp({projectId:'demo-bxh-registration-feedback'});
const db=require('firebase-admin/firestore').getFirestore();
const {create}=require('../modules/main-app/registration-feedback.js');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../qr-checkin/reference/writer-handlers.json'))),cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file).exports;const digest=fixture.files['familyRegistration/'+file],source=fixture.blobs[digest];assert(source);assert.equal(crypto.createHash('sha256').update(source).digest('hex'),digest);
 const module={exports:{}};cache.set(file,module);new Function('require','module','exports',source)(name=>name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+(/\.js$/.test(name)?'':'.js')):require(name),module,module.exports);return module.exports;
}
const handle=load('family-registration.js').createFamilyRegistration(db);
function memory(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
let serial=0;
async function seed(){
 const code='BXH-FE'+String(++serial).padStart(5,'0'),uid='emulator-user',now=Date.now(),room={capacity:32,waitlistEnabled:true,waitlistCapacity:8,confirmedCount:0,waitlistCount:0,tournamentPhase:'waiting',registrationEnabled:true,registrationVisibility:'public',visibility:'public',publishedAt:now-1000,registrationOpenAt:now-1000,registrationCloseAt:now+3600000,cancellationDeadline:now+300000,data:JSON.stringify({meta:{},players:[]})};
 const batch=db.batch();batch.set(db.doc('users/'+uid),{active:true,role:'player',realName:'Synthetic Player',phone:'0000000000',profileCompleted:true});batch.set(db.doc('tournaments/'+code),room);batch.set(db.doc('publicTournaments/'+code),room);await batch.commit();
 const call=data=>handle({auth:{uid},data}),request={action:'join',code,childIds:[null],allocation:[{registrationId:uid,status:'confirmed'}],childEligibilityConfirmed:true,operationId:'feedback-emulator-'+serial};
 const control=(storage=memory(),options={})=>create({getUid:()=>uid,storage,read:()=>call({action:'mine',code}),retry:call,...options});
 async function audit(expected){const [t,p,r]=await Promise.all([db.doc('tournaments/'+code).get(),db.doc('publicTournaments/'+code).get(),db.collection('tournaments/'+code+'/registrations').get()]);assert.equal(t.data().confirmedCount,expected);assert.equal(p.data().confirmedCount,expected);assert.equal(r.docs.filter(d=>d.data().status==='confirmed').length,expected);}
 return {code,uid,call,request,control,audit};
}
after(()=>db.terminate());
test('actual backend commit followed by response loss is recovered with one registration',async()=>{
 const x=await seed(),api=x.control();try{const result=await api.run(x.code,async progress=>{progress.submitting([x.uid],x.request);await x.call(x.request);throw Error('simulated-network-loss');});assert.equal(result.recovered,true);await x.audit(1);}finally{api.dispose();}
});
test('refresh and explicit same-operation retry creates one registration and retains the operation ID',async()=>{
 const x=await seed(),storage=memory(),first=x.control(storage);try{await assert.rejects(first.run(x.code,async p=>{p.submitting([x.uid],x.request);throw Error('network-before-server');}),/result-pending/);}finally{first.dispose();}
 const restored=x.control(storage);try{restored.restore();const result=await restored.retryOriginal(x.code);assert.equal(result.status,'confirmed');assert.equal(storage.length,0);await x.audit(1);await x.call(x.request);await x.audit(1);}finally{restored.dispose();}
});
test('replayed historical success after cancellation never displays active success',async()=>{
 const x=await seed(),storage=memory(),first=x.control(storage,{read:async()=>{throw Error('read-network-loss');}});try{await assert.rejects(first.run(x.code,async p=>{p.submitting([x.uid],x.request);await x.call(x.request);throw Error('reply-network-loss');}),/result-pending/);}finally{first.dispose();}
 await x.call({action:'cancel',code:x.code,operationId:'feedback-cancel-001'});const restored=x.control(storage);try{restored.restore();await assert.rejects(restored.retryOriginal(x.code),/no-longer-active/);assert.equal(restored.snapshot()[0].state,'failed');await x.audit(0);}finally{restored.dispose();}
});
