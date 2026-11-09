'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixture=require('./live-source-20261105.json');
const {HttpsError}=require('firebase-functions/v2/https');
function wrap(call,{projectId='bxh-arena'}={}){
 const digest=fixture.files['family.js'],source=fixture.blobs[digest];
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),digest);
 const module={exports:{}},options=[];let factories=0;
 const unused=()=>async()=>{throw Error('unexpected unrelated service invocation');};
 function load(name){
  if(name==='firebase-functions/v2/https')return {HttpsError,onCall:(settings,handler)=>{options.push(settings);return handler;}};
  if(name==='./_qr_checkin/admin-firestore.cjs')return {getFirestore:()=>({})};
  if(name==='firebase-admin/auth')return {getAuth:()=>({})};
  if(name==='./family-registration')return {createFamilyRegistration:()=>{factories++;return call;}};
  if(name==='./my-events-writer-flags.cjs'){
   const flags={exports:{}};new Function('module','exports',fixture.blobs[fixture.files['my-events-writer-flags.cjs']])(flags,flags.exports);return flags.exports;
  }
  if(name==='./family-service')return {createFamilyService:unused};
  if(name==='./registration-invitations')return {createRegistrationInvitationService:unused};
  if(name==='./family-transfer')return {createFamilyTransferService:unused};
  throw Error('unexpected fixture dependency '+name);
 }
 new Function('require','module','exports','process',source)(load,module,module.exports,{env:{GCLOUD_PROJECT:projectId}});
 assert.equal(factories,1);
 const client=async req=>{
  try{return await module.exports.familyRegistration(req);}
  catch(error){
   assert(error instanceof HttpsError);const wire=error.toJSON();
   throw Object.assign(Error(wire.message),{code:'functions/'+error.code,details:wire.details});
  }
 };
 client.options=options[1];return client;
}
module.exports={wrap};
