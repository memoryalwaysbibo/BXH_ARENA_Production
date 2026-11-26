'use strict';
const {summary}=require('./hold-core.cjs');

// Server-internal operation. All revisions since the last publication can be
// coalesced into one projection. No scans of holds or registration rows.
function createSummarySync({db,clock=Date.now,observe=()=>{}}){
 return async code=>{
  if(typeof code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');
  const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),
   ledger=room.collection('registrationV3State').doc('ledger');
  let reads=0,attempts=0,writesAttempted=0,committedWrites=0;
  const begin=clock();
  try{
   const result=await db.runTransaction(async tx=>{
    attempts++;reads+=3;
    const [rs,ps,ls]=await tx.getAll(room,pub,ledger);
    const r=rs.data(),p=ps.data(),l=ls.data();
    if(r?.registrationFlowVersion!==3||p?.registrationFlowVersion!==3||!ls.exists)throw Error('registration-v3-required');
    const fields=summary(l);
    if(r.capacity!==l.capacity||p.capacity!==l.capacity)throw Error('registration-state-conflict');
    const a=r.registrationSummaryRevision??0,b=p.registrationSummaryRevision??0;
    if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<0||a>l.revision||b>l.revision)
      throw Error('registration-state-conflict');
    const current=x=>Object.entries(fields).every(([k,v])=>x[k]===v);
    if(a===l.revision&&b===l.revision&&current(r)&&current(p)){
      committedWrites=0;return {ok:true,revision:l.revision,changed:false};
    }
    const patch={...fields,registrationSummaryRevision:l.revision,registrationSummaryUpdatedAt:clock()};
    tx.update(room,patch);tx.update(pub,patch);
    writesAttempted+=2;committedWrites=2;
    return {ok:true,revision:l.revision,changed:true};
   });
   try{observe({action:'summary',attempts,reads,writesAttempted,committedWrites,elapsedMs:clock()-begin,ok:true});}catch{}
   return result;
  }catch(error){
   try{observe({action:'summary',attempts,reads,writesAttempted,committedWrites:0,elapsedMs:clock()-begin,ok:false});}catch{}
   throw error;
  }
 };
}
module.exports={createSummarySync};
