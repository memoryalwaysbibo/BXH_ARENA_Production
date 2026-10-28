'use strict';
const {randomUUID}=require('node:crypto');
const CONTROL='teamDissolutionControlV1/current',LEASE_MS=10*60*1000;
// Server-only candidate. Scheduler integration and deployment are separate.
function createDissolutionCoordinator({db,worker,enabled=()=>false,clock=Date.now,newId=randomUUID}){
 const ref=db.doc(CONTROL);
 async function run(){
  if(!enabled())return {status:'disabled'};
  const leaseId=newId();
  const claim=await db.runTransaction(async tx=>{
   const snap=await tx.get(ref),state=snap.exists?snap.data():{},now=clock();
   if(state.leaseId&&state.leaseUntil>now)return null;
   tx.set(ref,{...state,leaseId,leaseUntil:now+LEASE_MS},{merge:true});return {cursor:state.cursor??null};
  });
  if(!claim)return {status:'busy'};
  try{
   const result=await worker.runSweepFrom(claim.cursor);
   const saved=await db.runTransaction(async tx=>{const snap=await tx.get(ref),state=snap.exists?snap.data():{};if(state.leaseId!==leaseId||state.leaseUntil<=clock())return false;
    tx.set(ref,{cursor:result.nextCursor,leaseId:null,leaseUntil:0,updatedAt:clock(),lastExamined:result.examined,lastDissolved:result.dissolved,lastFailed:result.failed},{merge:true});return true;});
   return {status:saved?'completed':'lease-expired',...result};
  }catch(error){
   await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists&&snap.data().leaseId===leaseId)tx.set(ref,{leaseId:null,leaseUntil:0},{merge:true});});throw error;
  }
 }
 return {run};
}
module.exports={createDissolutionCoordinator,CONTROL,LEASE_MS};
