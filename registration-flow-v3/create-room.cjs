'use strict';
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {summary}=require('./hold-core.cjs');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const active=u=>u?.active===true&&!u.deleted&&u.isTestAccount!==true&&u.role==='super_admin'&&!['deleted','disabled','frozen'].includes(u.accountStatus);
function normalize(d){
 const text=(v,max)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():null;
 const name=text(d.name,80),location=text(d.location,160);
 const {capacity,stations,registrationOpenAt,registrationCloseAt,cancellationDeadline}=d;
 if(!name||!location||!Number.isSafeInteger(capacity)||capacity<1||capacity>192||
 !Number.isSafeInteger(stations)||stations<1||stations>12||
 ![registrationOpenAt,registrationCloseAt,cancellationDeadline].every(x=>Number.isSafeInteger(x)&&x>0)||
 registrationOpenAt>=registrationCloseAt)throw Error('invalid-room-settings');
 return {name,location,capacity,stations,registrationOpenAt,registrationCloseAt,cancellationDeadline};
}
function documents({input,code,owner,roomId,now}){
 const ledger={capacity:input.capacity,occupiedCount:0,pendingReviewCount:0,confirmedCount:0,sequence:0,revision:0};
 const common={...summary(ledger),registrationFlowVersion:3,registrationSummaryRevision:0,
 name:input.name,location:input.location,eventAuthority:'official',formatType:'single',battleMode:'individual',
 ladderMode:'general',tournamentPhase:'waiting',archiveStatus:'ongoing',visibility:'private',
 registrationVisibility:'private',publishedAt:null,registrationEnabled:false,registrationStatus:'draft',
 registrationOpenAt:input.registrationOpenAt,registrationCloseAt:input.registrationCloseAt,cancellationDeadline:input.cancellationDeadline,
 waitlistEnabled:false,waitlistCapacity:0,waitlistCount:0,createdAt:now,updatedAt:now};
 const meta={name:input.name,location:input.location,stations:input.stations,eventAuthority:'official',formatType:'single',
 battleMode:'individual',ladderMode:'general',registrationCapacity:input.capacity,registrationEnabled:false,
 registrationStatus:'draft',registrationOpenAt:input.registrationOpenAt,registrationCloseAt:input.registrationCloseAt,
 cancellationDeadline:input.cancellationDeadline,registrationVisibility:'private',checkinRequired:true};
 const state={id:roomId,cloudCode:code,meta,archiveStatus:'ongoing',players:[],waitlistPlayers:[],matches:[],teams:[],
 bracketSize:0,registrationRosterRevision:0,updatedAt:now};
 return {ledger,privateRoom:{...common,ownerUid:owner,createdBy:owner,createdByRole:'super_admin',assignedStaffUids:[],
  data:JSON.stringify({...state,ownerUid:owner,createdBy:owner})},publicRoom:{...common,bracketView:JSON.stringify(state)}};
}
function createRoomHandler({db,clock=Date.now,newCode=()=> 'BXH-'+randomBytes(3).toString('hex').toUpperCase(),newId=randomUUID}){
 return async request=>{
  const uid=request.auth?.uid,d=request.data||{};
  if(typeof uid!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('auth-required');
  if(!request.app)throw Error('app-check-required');
  if(typeof d.operationId!=='string'||! /^[A-Za-z0-9_-]{8,100}$/.test(d.operationId))throw Error('invalid-operation');
  const input=normalize(d),fingerprint=hash(input),code=newCode(),roomId=newId();
  if(!/^BXH-[A-Z0-9]{6}$/.test(code))throw Error('invalid-code');
  const op=db.doc('registrationV3RoomCreateOperations/'+hash([uid,d.operationId]));
  return db.runTransaction(async tx=>{
   const [actor,prior]=await tx.getAll(db.doc('users/'+uid),op);
   if(!active(actor.data()))throw Error('super-admin-required');
   if(prior.exists){
    if(prior.data().fingerprint!==fingerprint)throw Error('operation-conflict');
    return {...prior.data().result,replayed:true};
   }
   const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),ledger=room.collection('registrationV3State').doc('ledger');
   const existing=await tx.getAll(room,pub,ledger);
   if(existing.some(s=>s.exists))throw Error('room-code-conflict');
   const now=clock(),docs=documents({input,code,owner:uid,roomId,now});
   const result={ok:true,code,roomId,registrationFlowVersion:3};
   tx.create(room,docs.privateRoom);tx.create(pub,docs.publicRoom);tx.create(ledger,docs.ledger);
   tx.create(op,{fingerprint,result,createdAt:now});
   return result;
  });
 };
}
module.exports={createRoomHandler,documents,normalize};
