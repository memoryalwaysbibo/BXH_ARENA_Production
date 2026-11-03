'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const project='demo-bxh-bucket-admissions';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert(/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''));
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {specs,fixture,NOW,code,uid}=require('./probe.cjs');
const app=initializeApp({projectId:project}),db=getFirestore(app);
db.settings({host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bucket-admissions-native-'));
const started=Date.now(); // Keep SDK/gRPC deadlines on the real process clock.
const handlers=new Map(),collections=['tournaments','publicTournaments','users','userMail','mailboxStats'];
function handler(spec,candidate){const key=spec.function+candidate;if(handlers.has(key))return handlers.get(key);
 const dest=path.join(directory,key);fs.mkdirSync(dest,{recursive:true});fs.cpSync(path.join(__dirname,'fixtures',String(spec.sourceSet)),dest,{recursive:true});
 if(candidate)fs.copyFileSync(path.resolve(__dirname,'../../../release/buckets/admissions/candidate',String(spec.sourceSet),spec.path),path.join(dest,spec.path));
 const mod=require(path.join(dest,spec.path));
 const fn=spec.function==='registrationInvitations'?mod.createRegistrationInvitationService(db,()=>NOW):mod[spec.function].run;handlers.set(key,fn);return fn;
}
async function clear(){for(const name of collections)await db.recursiveDelete(db.collection(name));}
async function seed(f){await clear();const b=db.batch();for(const [p,v]of f.m.rows)b.set(db.doc(p),p==='publicTournaments/'+code?{...v,registrationOpenAt:started-60000,registrationCloseAt:started+3600000}:v);await b.commit();}
function normalized(value,key=''){
 if(typeof value==='number'&&['updatedAt','configuredAt','createdAt'].includes(key)&&value>=started-1000&&value<=Date.now()+10000)return '<business-wallclock>';
 if(value&&typeof value.toMillis==='function')return '<server-timestamp>';
 if(typeof value==='string'&&/^[\[{]/.test(value)){try{return normalized(JSON.parse(value));}catch{}}
 if(Array.isArray(value))return value.map(v=>normalized(v));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='sourceCreatedAt').map(([k,v])=>[k,normalized(v,k)]));return value;
}
async function state(){const rows=[];
 async function walk(col){for(const ref of await col.listDocuments()){const snap=await ref.get();if(snap.exists)rows.push([ref.path,normalized(snap.data())]);for(const child of await ref.listCollections())await walk(child);}}
 for(const col of collections)await walk(db.collection(col));return rows.sort(([a],[b])=>a.localeCompare(b));
}
(async()=>{let checks=0;
 try{
  for(const spec of specs){
   const actions=spec.function==='manageEntrySelection'?['configure','preview']:spec.function==='lotteryRegistration'?['join','cancel']:['invite','accept','decline','expired','replay'];
   for(const action of actions){
    const f=fixture(spec,action);let original;
    for(const candidate of [false,true]){await seed(f);const result=await handler(spec,candidate)(f.request),view={result:normalized(result),rows:await state()};if(!candidate)original=view;else assert.deepEqual(view,original,spec.function+' '+action+' native legacy drift');}checks++;
    for(const marker of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])for(const value of [null,false,{},'unknown',{status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
     await seed(f);const batch=db.batch();batch.update(db.doc('tournaments/'+code),{data:'{invalid'});batch.update(db.doc(side+'/'+code),{[marker]:value});await batch.commit();
     const before=await state();await assert.rejects(handler(spec,true)(f.request),/bucket-scoring-required/);assert.deepEqual(await state(),before);checks++;
    }
   }
  }
  const inv=specs.find(s=>s.function==='registrationInvitations'),root=db.doc('tournaments/'+code);
  for(const action of ['accept','decline','expired','replay'])for(const kind of ['deleted','reused','mismatchedGeneration']){
   const f=fixture(inv,action);await seed(f);
   if(kind==='mismatchedGeneration')await root.collection('registrationInvitations').doc(uid).update({sourceCreatedAt:'wrong-generation'});
   else {const saved=(await root.get()).data();await root.delete();if(kind==='reused')await root.set(saved);}
   const before=await state();await assert.rejects(handler(inv,true)(f.request),/not-found|invitation-room-changed/);assert.deepEqual(await state(),before);checks++;
  }
  // Two native transactions for the same invitation must create one mail/counter.
  {const f=fixture(inv,'invite');await seed(f);const fn=handler(inv,true),out=await Promise.allSettled([fn(f.request),fn(f.request)]);
   assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.match(out.find(x=>x.status==='rejected').reason.message,/invite-pending/);
   assert.equal((await db.doc('mailboxStats/target').get()).data().unreadCount,1);
   const record=await root.collection('registrationInvitations').doc('target').get(),r=await root.get();assert.equal(record.data().sourceCreatedAt,r.createTime.seconds+':'+r.createTime.nanoseconds);checks++;
  }
  console.log(JSON.stringify({nativeAdmissionChecks:checks,project,productionRequests:0,productionWrites:0,scope:'real Admin SDK, QR proxy and transport clock; synthetic request auth and injected invitation clock'}));
 }finally{await clear();await db.terminate();await deleteApp(app);fs.rmSync(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
