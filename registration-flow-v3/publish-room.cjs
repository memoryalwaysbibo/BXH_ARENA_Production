'use strict';
const {canReview}=require('./permissions.cjs');
const {summary}=require('./hold-core.cjs');
function createPublishHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,d=request.data||{};
  if(typeof uid!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('auth-required');
  if(!request.app)throw Error('app-check-required');
  if(typeof d.code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(d.code))throw Error('invalid-code');
  const room=db.doc('tournaments/'+d.code),pub=db.doc('publicTournaments/'+d.code),ledger=room.collection('registrationV3State').doc('ledger');
  return db.runTransaction(async tx=>{
   const [rs,ps,ls,us]=await tx.getAll(room,pub,ledger,db.doc('users/'+uid));
   const r=rs.data(),p=ps.data(),l=ls.data(),now=clock();
   if(r?.registrationFlowVersion!==3||p?.registrationFlowVersion!==3||!ls.exists)throw Error('registration-v3-required');
   if(!canReview({room:r,user:us.data(),uid,now}))throw Error('permission-denied');
   if(r.publishedAt&&p.publishedAt&&r.registrationEnabled&&p.registrationEnabled)return {ok:true,code:d.code,replayed:true};
   const counts=summary(l);
   if(l.revision!==0||counts.occupiedCount!==0||r.capacity!==l.capacity||p.capacity!==l.capacity||r.registrationStatus!=='draft'||p.registrationStatus!=='draft')throw Error('registration-state-conflict');
   if(!r.name||!r.location||!/^\d{4}-\d{2}-\d{2}$/.test(r.eventDate||'')||
     !/^\d{2}:\d{2}$/.test(r.startAt||'')||
     ![r.registrationOpenAt,r.registrationCloseAt,r.cancellationDeadline].every(Number.isSafeInteger)||
     r.registrationOpenAt>=r.registrationCloseAt||r.registrationCloseAt<=now)throw Error('invalid-room-settings');
   const starts=Date.parse(r.eventDate+'T'+r.startAt+'+08:00');
   if(!Number.isFinite(starts)||r.registrationCloseAt>starts)throw Error('invalid-room-settings');
   const registrationStatus=r.registrationOpenAt<=now?'open':'scheduled';
   const fields={visibility:'public',registrationVisibility:'public',registrationEnabled:true,publishedAt:now,registrationStatus,updatedAt:now};
   const project=(raw)=>{const s=JSON.parse(raw);return JSON.stringify({...s,updatedAt:now,meta:{...s.meta,...fields}});};
   tx.update(room,{...fields,data:project(r.data)});
   tx.update(pub,{...fields,bracketView:project(p.bracketView)});
   return {ok:true,code:d.code,registrationStatus};
  });
 };
}
module.exports={createPublishHandler};
