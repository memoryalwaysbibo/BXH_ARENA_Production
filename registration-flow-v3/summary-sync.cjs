'use strict';
const {summary}=require('./hold-core.cjs');
const {project}=require('./roster.cjs');

// Server-internal operation. All revisions since the last publication can be
// coalesced into one projection. No scans of holds or registration rows.
function createSummarySync({db,clock=Date.now,observe=()=>{}}){
 return async (code,{authorize}={})=>{
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
    if(authorize&&await authorize(tx,r)!==true)throw Error('permission-denied');
    const fields=summary(l);
    if(r.capacity!==l.capacity||p.capacity!==l.capacity)throw Error('registration-state-conflict');
    const a=r.registrationSummaryRevision??0,b=p.registrationSummaryRevision??0;
    if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<0||a>l.revision||b>l.revision)
      throw Error('registration-state-conflict');
    const formal=l.formalRevision??0;
    const ar=r.registrationFormalRevision??0,br=p.registrationFormalRevision??0;
    if(![ar,br].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=formal))throw Error('registration-state-conflict');
    const rosterDirty=ar!==formal||br!==formal;
    const current=x=>Object.entries(fields).every(([k,v])=>x[k]===v);
    if(!rosterDirty&&a===l.revision&&b===l.revision&&current(r)&&current(p)){
      committedWrites=0;return {ok:true,revision:l.revision,changed:false};
    }
    const patch={...fields,registrationSummaryRevision:l.revision,registrationSummaryUpdatedAt:clock()};
    let roster={privatePatch:{},publicPatch:{}};
    if(rosterDirty){
      const snapshot=await tx.get(room.collection('registrations').where('status','==','confirmed'));
      reads+=snapshot.size;
      const rows=snapshot.docs.map(doc=>({...doc.data(),registrationId:doc.id}));
      if(rows.length!==l.confirmedCount)throw Error('registration-state-conflict');
      roster=project(r,p,rows,clock());
    }
    tx.update(room,{...patch,registrationFormalRevision:formal,...roster.privatePatch});
    tx.update(pub,{...patch,registrationFormalRevision:formal,...roster.publicPatch});
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
