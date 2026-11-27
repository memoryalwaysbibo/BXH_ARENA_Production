'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomBytes}=require('node:crypto'),{prepare}=require('./release/prepare-writers.cjs'),pins=require('./release/writer-pins.json');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration-v3');
const capture=process.env.BXH_V3_WRITER_CAPTURE;
assert(capture,'reviewed writer capture required');
const {initializeApp}=require('firebase-admin/app'),{getFirestore,FieldValue}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:process.env.GCLOUD_PROJECT}));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bxh-v3-legacy-'));
function load(name){
 const dest=path.join(temp,name);fs.cpSync(path.join(capture,name),dest,{recursive:true});
 const file=path.join(dest,pins[name].path);
 fs.writeFileSync(file,prepare(name,fs.readFileSync(file,'utf8')));
 return require(file);
}
async function main(){
 const family=load('familyRegistration').createFamilyRegistration(db);
 const roster=load('registrationRosterService').createRosterService(db,FieldValue);
 const suffix=randomBytes(4).toString('hex'),uid='player-'+suffix,admin='admin-'+suffix,now=Date.now();
 const batch=db.batch(),codes=[1,2,3].map(v=>'BXH-V'+v+suffix.toUpperCase());
 batch.set(db.doc('users/'+uid),{active:true,role:'player',realName:'Synthetic',phone:'000',profileCompleted:true});
 batch.set(db.doc('users/'+admin),{active:true,role:'super_admin'});
 for(let i=0;i<3;i++){
  const code=codes[i],version=i+1;
  const common={eventAuthority:'official',ownerUid:admin,createdBy:admin,visibility:'public',registrationVisibility:'public',
  tournamentPhase:'waiting',archiveStatus:'ongoing',publishedAt:now-1000,registrationEnabled:true,registrationStatus:'open',
  registrationOpenAt:now-1000,registrationCloseAt:now+3600000,cancellationDeadline:now+3600000,capacity:8,confirmedCount:0,waitlistCount:0,waitlistEnabled:false,
  ...(version===2?{registrationQueueVersion:2}:version===3?{registrationFlowVersion:3}:{})};
  const runtime=JSON.stringify({meta:{registrationAutoFillEnabled:true},players:[],waitlistPlayers:[],matches:[]});
  batch.set(db.doc('tournaments/'+code),{...common,data:runtime});
  batch.set(db.doc('publicTournaments/'+code),{...common,bracketView:runtime});
 }
 await batch.commit();
 const join=code=>family({auth:{uid},data:{code,action:'join',operationId:'join-'+code,childIds:[null],childEligibilityConfirmed:true}});
 assert.equal((await join(codes[0])).status,'confirmed');
 await assert.rejects(join(codes[1]),/registration-queue-required/);
 await assert.rejects(join(codes[2]),/registration-v3-required/);
 const configure=code=>roster({auth:{uid:admin},data:{code,action:'configure',enabled:false,operationId:'configure-'+code}});
 assert.equal((await configure(codes[0])).ok,true);
 await assert.rejects(configure(codes[1]),/registration-queue-required/);
 await assert.rejects(configure(codes[2]),/registration-v3-required/);
 assert.equal((await db.doc('tournaments/'+codes[2]).get()).data().confirmedCount,0);
 console.log('PASS captured family and roster writer candidates: V1 normal mutation, V2 ownership and V3 ownership guards');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await db.terminate();fs.rmSync(temp,{recursive:true,force:true});});
