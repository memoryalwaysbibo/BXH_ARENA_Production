'use strict';

const {createHash}=require('node:crypto');
const {ticketHostGrant,checkTicketContract}=require('./ticket-host.cjs');

const fields=new Set(['action','code','ticketId','operationId','name','location','stations',
 'registrationOpenAt','registrationCloseAt','startAt']);
const roomIdPattern=/^[A-Za-z0-9_-]{8,100}$/;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function requestData(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.has(key))||
    input.action!=='create-ticket-room'||typeof input.code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(input.code)||
    typeof input.ticketId!=='string'||!/^BXH-SO-[A-Z0-9]{24}$/.test(input.ticketId)||
    typeof input.operationId!=='string'||!roomIdPattern.test(input.operationId))throw Error('invalid-operation');
 const {code,ticketId,operationId,stations,registrationOpenAt,registrationCloseAt,startAt}=input;
 const name=typeof input.name==='string'?input.name.trim():'';
 const location=typeof input.location==='string'?input.location.trim():'';
 if(!name||name.length>80||location.length>160||(input.location!=null&&typeof input.location!=='string')||
    !Number.isInteger(stations)||stations<1||stations>12||
    ![registrationOpenAt,registrationCloseAt,startAt].every(at=>Number.isSafeInteger(at)&&at>0)||
    !(registrationOpenAt<registrationCloseAt&&registrationCloseAt<=startAt))throw Error('invalid-operation');
 return {code,ticketId,operationId,name,location,stations,registrationOpenAt,registrationCloseAt,startAt};
}

function roomDocuments({input,capacity,owner,grant,roomId,now}){
 const {code,ticketId,name,location,stations,registrationOpenAt,registrationCloseAt,startAt}=input;
 const common={name,location,capacity,eventAuthority:'ticket',ladderMode:'ranked',formatType:'single',
  battleMode:'individual',tournamentPhase:'waiting',archiveStatus:'ongoing',createdByRole:'partner_organizer',
  visibility:'public',registrationVisibility:'public',publishedAt:now,registrationEnabled:true,
  registrationOpenAt,registrationCloseAt,cancellationDeadline:registrationCloseAt,startAt,
  registrationStatus:registrationOpenAt<=now?'open':'upcoming',
  confirmedCount:0,waitlistEnabled:false,waitlistCount:0,waitlistCapacity:0,updatedAt:now,bracketSize:0};
 const meta={name,location,stations,eventAuthority:'ticket',ladderMode:'ranked',formatType:'single',
  battleMode:'individual',registrationCapacity:capacity,registrationEnabled:true,registrationOpenAt,
  registrationCloseAt,startAt,registrationStatus:common.registrationStatus,checkinRequired:false};
 const state={id:roomId,cloudCode:code,meta,updatedAt:now,archiveStatus:'ongoing',
  players:[],waitlistPlayers:[],matches:[],teams:[],bracketSize:0,courtAssignments:{},registrationRosterRevision:0};
 const ticketAccessV1={version:1,ticketId,ownerUid:owner,roomId,baseCapacity:capacity,addedCapacity:0};
 return {
  privateRoom:{...common,createdBy:owner,ownerUid:owner,partnerOrganizationCode:grant.organizationId,
   partnerContractOrderCode:grant.order,ticketAccessV1,registrationQueueVersion:2,
   data:JSON.stringify({...state,ownerUid:owner,createdBy:owner,createdByRole:common.createdByRole})},
  publicRoom:{...common,ticketRoomVersion:1,bracketView:JSON.stringify(state)}
 };
}

function createTicketRoomHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid;
  if(typeof uid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(uid))throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const input=requestData(request.data),{code,ticketId,operationId}=input;
  const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
  const ticket=db.doc('commerceTickets/'+ticketId),order=db.doc('commerceOrders/'+ticketId);
  const receipt=room.collection('operationLog').doc('ticket-room-create-'+digest([uid,operationId]));
  const release=db.doc('systemSettings/commerceTicketLifecycleV1');
  const requestHash=digest(input);
  return db.runTransaction(async tx=>{
   const now=clock();
   const [profileSnap,roomSnap,publicSnap,ticketSnap,orderSnap,gateSnap,receiptSnap]=await tx.getAll(
    db.doc('users/'+uid),room,pub,ticket,order,release,receipt);
   const grant=ticketHostGrant(profileSnap.data(),now);
   if(!grant)throw Error('permission-denied');
   const held=ticketSnap.data(),paid=orderSnap.data(),gate=gateSnap.data();
   if(receiptSnap.exists){
    const prior=receiptSnap.data(),existing=roomSnap.data();
    if(prior.requestHash!==requestHash)throw Error('operation-conflict');
    if(!existing||publicSnap.data()?.ticketRoomVersion!==1||existing.ownerUid!==uid||
       existing.ticketAccessV1?.ticketId!==ticketId||existing.ticketAccessV1?.roomId!==prior.roomId||
       held?.boundRoomCode!==code||held?.boundRoomId!==prior.roomId)throw Error('room-receipt-inconsistent');
    return {ok:true,code,roomId:prior.roomId,replayed:true};
   }
   if(gate?.bindingEnabled!==true||gate.roomCode!==code||gate.ownerUid!==uid||
      typeof gate.roomId!=='string'||!roomIdPattern.test(gate.roomId))throw Error('ticket-lifecycle-disabled');
   if(roomSnap.exists||publicSnap.exists)throw Error('room-code-conflict');
   if(held?.version!==1||held.id!==ticketId||held.orderId!==ticketId||held.ownerUid!==uid||
      held.status!=='available'||held.usedAt||held.boundRoomCode!==null||held.boundRoomId!=null||
      held.addedCapacity!==0)throw Error('ticket-unavailable');
   if(!Number.isSafeInteger(held.expiresAt)||held.expiresAt<=now||input.startAt>=held.expiresAt)throw Error('ticket-expired');
   if(input.registrationCloseAt<=now||input.startAt<=now||input.startAt>=grant.expiresAt)throw Error('invalid-operation');
   const spec=paid?.productSnapshot?.delivery;
   if(paid?.id!==ticketId||paid.ownerUid!==uid||paid.paymentStatus!=='paid'||paid.deliveryStatus!=='delivered'||
      paid.ticketOrganizationId!==grant.organizationId||(paid.contractCode||null)!==grant.order||
      (held.contractCode||null)!==grant.order||spec?.kind!=='ticket'||spec.assetId!==String(held.capacity)||
      ![32,64,96,128,160].includes(held.capacity))throw Error('ticket-binding-invalid');
   if(grant.order)checkTicketContract((await tx.get(db.doc('partnerContracts/'+grant.order))).data(),grant,uid);
   const roomId=gate.roomId;
   const {privateRoom,publicRoom}=roomDocuments({input,capacity:held.capacity,owner:uid,grant,roomId,now});
   tx.create(room,privateRoom);
   tx.create(pub,publicRoom);
   tx.update(ticket,{status:'reserved',boundRoomCode:code,boundRoomId:roomId,updatedAt:now});
   tx.create(receipt,{requestHash,roomId});
   return {ok:true,code,roomId};
  });
 };
}
module.exports={createTicketRoomHandler};
