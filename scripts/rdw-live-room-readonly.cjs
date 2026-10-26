#!/usr/bin/env node
'use strict';
// RDW P3-27 live room read-only attestation. No writes or deployments.
// Usage: BXH_EVENT_CODE=BXH-SDSAQZ BXH_EXPECTED_UID=... node scripts/rdw-live-room-readonly.cjs
// Run only with production read permissions and a confirmed project id.
const {attestParticipant}=require('./lib/rdw-participant-attestation.cjs');
const {getApps,initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
async function main(){
 const eventCode=process.env.BXH_EVENT_CODE,expectedUid=process.env.BXH_EXPECTED_UID;
 if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!/^[A-Za-z0-9_-]{1,128}$/.test(expectedUid||''))throw Error('event-code-and-uid-required');
 const project=process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT;
 if(project!=='bxh-arena')throw Error('production-project-must-be-explicitly-bxh-arena');
 const app=getApps()[0]||initializeApp({projectId:project});
 const snap=await getFirestore(app).doc('tournaments/'+eventCode).get();
 if(!snap.exists){console.log(JSON.stringify({eventCode,roomFound:false}));return;}
 const room=snap.data();
 const attestation=attestParticipant({room,eventCode,expectedUid});
 let state=room?.data;
 if(typeof state==='string'){try{state=JSON.parse(state);}catch{state=null;}}
 const output={
  eventCode,roomFound:true,
  registrationRosterRevision:Number.isSafeInteger(state?.registrationRosterRevision)?state.registrationRosterRevision:null,
  started:Boolean(state?.startedAt),
  rosterLocked:state?.rosterLocked===true,
  rosterSize:Array.isArray(state?.players)?state.players.length:null,
  participantMatched:attestation.ok,
  participantReason:attestation.ok?null:attestation.reason,
  playerId:attestation.ok?attestation.playerId:null,
  // Deliberately omit the UID, name, room JSON, other participants and private records.
 };
 console.log(JSON.stringify(output,null,2));
 if(!attestation.ok)process.exitCode=2;
}
main().catch(e=>{console.error('RDW read-only audit failed:',e.message);process.exitCode=1;});
