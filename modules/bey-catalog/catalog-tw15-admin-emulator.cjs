'use strict';
/**
 * TW-15: Firebase Admin SDK Firestore adapter, STRICTLY loopback Emulator-only.
 * This is a real Admin SDK transaction implementation, NOT a production writer.
 * No Cloud Function export, HTTP endpoint, or production deployment.
 */
const crypto=require('node:crypto');
const PROJECT='demo-bxh-catalog-db01';
const HOST='127.0.0.1:8189';
const OP='tw12.catalog.review.read';
const WINDOW_MS=60000;
const LIMIT=5;
const UID=/^[A-Za-z0-9_-]{2,128}$/;
function check(db,target){
 if(target?.mode!=='emulator'||target.projectId!==PROJECT||target.emulatorHost!==HOST||
    process.env.FIRESTORE_EMULATOR_HOST!==HOST||db?.projectId!==PROJECT||
    typeof db.runTransaction!=='function'||typeof db.collection!=='function')
  throw Error('TW15_LOCAL_ADMIN_EMULATOR_ONLY');
}
function createTw15AdminEmulatorGuards({db,target,Timestamp,FieldValue,secret,clock=()=>Date.now()}={}){
 check(db,target);
 if(!Timestamp||typeof Timestamp.fromMillis!=='function'||!FieldValue||typeof FieldValue.serverTimestamp!=='function'||
    typeof secret!=='string'||Buffer.byteLength(secret,'utf8')<32||typeof clock!=='function')
  throw Error('TW15_TRUSTED_DEPENDENCIES_REQUIRED');
 const hash=x=>crypto.createHmac('sha256',secret).update(x).digest('hex');
 function validate(uid,operation){
  if(!UID.test(uid||'')||operation!==OP)throw Error('TW15_INVALID_ACTOR_OR_OPERATION');
 }
 async function consumeRateLimit({uid,operation}={}){
  check(db,target);validate(uid,operation);
  const now=clock();
  if(!Number.isSafeInteger(now)||now<0)throw Error('TW15_CLOCK_INVALID');
  const window=Math.floor(now/WINDOW_MS);
  const key=hash(OP+'\0'+uid+'\0'+window);
  const ref=db.collection('beyCatalogTw15Quota').doc(key);
  return db.runTransaction(async tx=>{
   const snap=await tx.get(ref),old=snap.exists?snap.data():null;
   if(old&&(old.operation!==OP||old.window!==window||
      !Number.isInteger(old.count)||old.count<1||old.count>LIMIT))
    throw Error('TW15_QUOTA_CORRUPT');
   if(old&&old.count>=LIMIT)return false;
   tx.set(ref,{operation:OP,window,count:(old?.count||0)+1,
    expiresAt:Timestamp.fromMillis((window+2)*WINDOW_MS),
    emulatorOnly:true});
   return true;
  },{maxAttempts:5});
 }
 async function recordAudit({uid,operation,outcome,count,filter,sourceBatchId}={}){
  check(db,target);validate(uid,operation);
  if(!['preview','denied'].includes(outcome)||!Number.isSafeInteger(count)||count<0||count>20||
     !['all','P0','P1','P2'].includes(filter)||
     (sourceBatchId!==null&&sourceBatchId!=='DATA-01B-20261009-ZHTW-TW05')||
     (outcome==='denied'&&(count!==0||sourceBatchId!==null)))
    throw Error('TW15_INVALID_AUDIT');
  const ref=db.collection('beyCatalogTw15Audit').doc();
  await ref.create({actorHash:hash('actor\0'+uid),operation,outcome,count,filter,
   sourceBatchId,recordedAt:FieldValue.serverTimestamp(),
   publicationStatus:'unpublished',emulatorOnly:true});
  return true;
 }
 return Object.freeze({consumeRateLimit,recordAudit,emulatorOnly:true,adminSdk:true});
}
module.exports={createTw15AdminEmulatorGuards,WINDOW_MS,LIMIT};
