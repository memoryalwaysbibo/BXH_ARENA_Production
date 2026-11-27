'use strict';
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8199');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration-v3-rules');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:process.env.GCLOUD_PROJECT}));
const project=process.env.GCLOUD_PROJECT,host='http://127.0.0.1:8199',docs='/v1/projects/'+project+'/databases/(default)/documents';
// Synthetic identities accepted only by the local Firestore emulator.
function fixtureIdentity(uid){
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
 return encode({alg:'none',typ:'JWT'})+'.'+encode({aud:project,iss:'https://securetoken.google.com/'+project,sub:uid,user_id:uid,iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:'custom',identities:{}}})+'.';
}
async function update(path,fields,expected,uid){
 const mask=new URLSearchParams(Object.keys(fields).map(k=>['updateMask.fieldPaths',k]));
 const res=await fetch(host+docs+'/'+path+'?'+mask,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+fixtureIdentity(uid)},body:JSON.stringify({fields})});
 assert.equal(res.status,expected,path+' '+Object.keys(fields).join(',')+': '+(await res.text()).slice(0,300));
}
async function main(){
 const suffix=randomBytes(4).toString('hex'),admin='admin-'+suffix,player='player-'+suffix;
 const codes=[1,2,3].map(v=>'BXH-V'+v+suffix.toUpperCase()),batch=db.batch();
 batch.set(db.doc('users/'+admin),{active:true,role:'super_admin'});
 batch.set(db.doc('users/'+player),{active:true,role:'player'});
 for(let i=0;i<3;i++){
  const version=i+1,code=codes[i],common={eventAuthority:'official',createdBy:admin,ownerUid:admin,createdByRole:'super_admin',visibility:'public',ladderMode:'general',tournamentPhase:'waiting',archiveStatus:'ongoing',registrationEnabled:false,registrationStatus:'closed',confirmedCount:0,waitlistCount:0,capacity:8,updatedAt:1,...(version===2?{registrationQueueVersion:2}:version===3?{registrationFlowVersion:3,occupiedCount:0,pendingReviewCount:0,availableCount:8}:{})};
  batch.set(db.doc('tournaments/'+code),{...common,data:'{}'});
  batch.set(db.doc('publicTournaments/'+code),{...common,bracketView:'{}'});
  batch.set(db.doc('tournaments/'+code+'/registrations/'+player),{uid:player,status:'confirmed'});
 }
 await batch.commit();
 const field={capacity:{integerValue:'9'}};
 await update('tournaments/'+codes[2],field,403,admin);
 await update('publicTournaments/'+codes[2],field,403,admin);
 await update('tournaments/'+codes[2],{registrationFlowVersion:{integerValue:'1'}},403,admin);
 await update('tournaments/'+codes[2]+'/registrations/'+player,{status:{stringValue:'cancelled'}},403,admin);
 await update('tournaments/'+codes[2]+'/registrationV3State/ledger',{occupiedCount:{integerValue:'2'}},403,admin);
 await update('tournaments/'+codes[2]+'/registrationV3Holds/'+player,{status:{stringValue:'confirmed'}},403,player);
 await update('tournaments/'+codes[0],{updatedAt:{integerValue:'2'}},200,admin);
 await update('publicTournaments/'+codes[0],{updatedAt:{integerValue:'2'}},200,admin);
 await update('tournaments/'+codes[1],{updatedAt:{integerValue:'2'}},403,admin);
 console.log('PASS V3 protected fields and registration subcollections; V1 ordinary update and V2 existing ownership unchanged (local Firestore emulator)');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.terminate());
