'use strict';
/**
 * TW-14: Firestore Emulator ONLY atomic quota + minimal audit adapters.
 * Not a production deployment, not an Admin SDK adapter.
 * Real production deployment must use Admin Firestore, IAM, TTL policy and
 * durable audit retention with privacy review.
 */
const crypto=require('node:crypto');
const {doc,runTransaction,setDoc,serverTimestamp}=require('firebase/firestore');
const {verifyEmulator}=require('./catalog-emulator-transactions.cjs');
const UID=/^[A-Za-z0-9_-]{2,128}$/;
const OP='tw12.catalog.review.read';
const WINDOW_MS=60_000;
const LIMIT=5;
function assertActor(uid,operation){
 if(!UID.test(uid||'')||operation!==OP)throw Error('TW14_INVALID_ACTOR_OR_OPERATION');
}
function keyFor(uid,window){
 return crypto.createHash('sha256').update(OP+'\0'+uid+'\0'+window).digest('hex');
}
function createTw14EmulatorGuards({db,target,clock=()=>Date.now()}={}){
 verifyEmulator(db,target);
 if(typeof clock!=='function')throw Error('TW14_CLOCK_REQUIRED');
 async function consumeRateLimit({uid,operation}={}){
  verifyEmulator(db,target);assertActor(uid,operation);
  const now=clock();
  if(!Number.isSafeInteger(now)||now<0)throw Error('TW14_INVALID_CLOCK');
  const window=Math.floor(now/WINDOW_MS),ref=doc(db,'beyCatalogTw14Quota',keyFor(uid,window));
  return runTransaction(db,async tx=>{
   const snap=await tx.get(ref),old=snap.exists()?snap.data():null;
   if(old&&(old.operation!==OP||old.window!==window||old.count<1||old.count>LIMIT))throw Error('TW14_QUOTA_TAMPERED');
   if(old&&old.count>=LIMIT)return false;
   tx.set(ref,{operation:OP,window,count:(old?.count||0)+1,
    expiresAtMs:(window+1)*WINDOW_MS+WINDOW_MS,emulatorOnly:true});
   return true;
  },{maxAttempts:5});
 }
 async function recordAudit({uid,operation,outcome,count,filter,sourceBatchId}={}){
  verifyEmulator(db,target);assertActor(uid,operation);
  if(!['preview','denied'].includes(outcome)||!Number.isSafeInteger(count)||count<0||count>20||
     !['all','P0','P1','P2'].includes(filter)||
     (sourceBatchId!==null&&sourceBatchId!=='DATA-01B-20261009-ZHTW-TW05'))
    throw Error('TW14_INVALID_AUDIT_METADATA');
  if(outcome==='denied'&&(count!==0||sourceBatchId!==null))throw Error('TW14_DENIED_AUDIT_INVALID');
  const id=crypto.randomUUID(),ref=doc(db,'beyCatalogTw14Audit',id);
  await setDoc(ref,{actorHash:crypto.createHash('sha256').update(uid).digest('hex'),
   operation,outcome,count,filter,sourceBatchId:sourceBatchId||null,
   recordedAt:serverTimestamp(),emulatorOnly:true,publicationStatus:'unpublished'});
  return true;
 }
 return Object.freeze({consumeRateLimit,recordAudit,emulatorOnly:true});
}
module.exports={createTw14EmulatorGuards,WINDOW_MS,LIMIT};
