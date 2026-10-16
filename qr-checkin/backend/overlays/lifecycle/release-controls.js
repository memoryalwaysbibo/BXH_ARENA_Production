'use strict';
const {getFirestore}=require('firebase-admin/firestore');
const db=getFirestore();
const REF='systemSettings/releaseControls';
async function backgroundJobsEnabled(){
  try{
    const snap=await db.doc(REF).get();
    return snap.exists && snap.data().backgroundJobsEnabled===true;
  }catch(e){
    console.error('[release-controls] read failed; background jobs stay disabled',e);
    return false;
  }
}
async function memberRafflesEnabled(){
  try{
    const snap=await db.doc(REF).get();
    if(!snap.exists)return true;
    const data=snap.data()||{};
    if(typeof data.memberRafflesEnabled==='boolean')return data.memberRafflesEnabled;
    return true;
  }catch(e){
    console.error('[release-controls] read failed; member raffles stay disabled',e);
    return false;
  }
}
module.exports={backgroundJobsEnabled,memberRafflesEnabled,REF};
