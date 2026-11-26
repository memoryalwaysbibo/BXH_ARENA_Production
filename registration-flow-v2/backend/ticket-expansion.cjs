'use strict';
const {createHash}=require('node:crypto');
const {ticketHostGrant,checkTicketContract,isPartnerRoomCode}=require('./ticket-host.cjs');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kind='room_expansion',assetId='tournament_expansion_1';
const settingsPath='systemSettings/commerceRoomExpansionV1';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const requireThat=(condition,error)=>{if(!condition)throw Error(error);};
const parse=value=>{try{return JSON.parse(value);}catch{throw Error('ticket-capacity-invalid');}};
function capacityMatches({code,room,pub,state,mirror,ticket,maxCapacity}){
 const access=room?.ticketAccessV1,base=access?.baseCapacity,added=access?.addedCapacity;
 const total=base+added;
 requireThat([32,64,96,128,160].includes(base)&&integer(maxCapacity,1,192)&&
  integer(added,0,192-base)&&total<=maxCapacity&&
  (!added||isPartnerRoomCode(code)&&room.ptnSettlementVersion===1)&&
  (!ticket||ticket.capacity===base&&ticket.addedCapacity===added)&&
  room.capacity===total&&pub?.capacity===total&&state?.meta?.registrationCapacity===total&&
  (!mirror||mirror.meta?.registrationCapacity===total)&&
  Array.isArray(state?.players)&&state.players.length<=total,'ticket-capacity-invalid');
 return total;
}
// Closed candidate: bind to the registration callable only after the lifecycle,
// registration and deployed-source compatibility checks pass.
function createTicketExpansionHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,input=request.data||{};
  requireThat(id(uid),'auth-required');
  requireThat(request.app,'permission-denied');
  const {code,roomId,operationId,quantity}=input;
  requireThat(input.action==='ticket-room-expand'&&Object.keys(input).every(k=>['action','code','roomId','operationId','quantity'].includes(k))&&
   isPartnerRoomCode(code)&&id(roomId)&&id(operationId)&&operationId.length>=8&&integer(quantity,1,320),'invalid-operation');
  const hash=digest([code,roomId,quantity]),roomRef=db.doc('tournaments/'+code),
   publicRef=db.doc('publicTournaments/'+code),gateRef=db.doc('commerceTicketRoomGates/'+code),
   entRef=db.doc('commerceEntitlements/'+digest([uid,kind,assetId])),
   opRef=db.doc('commerceOperations/'+digest([uid,'ticket-room-expand',operationId]));
  return db.runTransaction(async tx=>{
   const now=clock(),[actor,r,p,g,e,op,cfg]=await tx.getAll(db.doc('users/'+uid),roomRef,publicRef,gateRef,entRef,opRef,db.doc(settingsPath));
   const room=r.data(),pub=p.data(),gate=g.data(),ent=e.data(),prior=op.data(),config=cfg.data();
   const grant=ticketHostGrant(actor.data(),now),access=room?.ticketAccessV1;
   requireThat(grant&&room?.ownerUid===uid&&room.createdBy===uid&&room.createdByRole==='partner_organizer'&&
    room.partnerOrganizationCode===grant.organizationId&&(room.partnerContractOrderCode||null)===grant.order&&
    access?.ownerUid===uid&&access.version===1&&access.roomId===roomId&&
    /^BXH-SO-[A-Z0-9]{24}$/.test(access.ticketId||'')&&gate?.enabled===true&&gate.bindingEnabled===true&&
    gate.roomCode===code&&gate.roomId===roomId&&gate.ownerUid===uid&&gate.ticketId===access.ticketId,'permission-denied');
   if(grant.order)checkTicketContract((await tx.get(db.doc('partnerContracts/'+grant.order))).data(),grant,uid);
   if(op.exists){
    requireThat(prior.actorUid===uid&&prior.action==='ticket-room-expand'&&prior.requestHash===hash&&prior.result?.roomId===roomId,'operation-conflict');
    return {...prior.result,replayed:true};
   }
   requireThat(config?.enabled===true&&integer(config.maxCapacity,1,192),'expansion-unavailable');
   requireThat(room.eventAuthority==='ticket'&&pub?.eventAuthority==='ticket'&&room.ptnSettlementVersion===1&&pub.ptnSettlementVersion===1&&
    pub.ticketRoomVersion===1&&room.registrationQueueVersion===2&&pub.registrationQueueVersion===2&&
    room.tournamentPhase==='waiting'&&pub.tournamentPhase==='waiting'&&
    room.archiveStatus==='ongoing'&&pub.archiveStatus==='ongoing'&&
    !room.startedAt&&!pub.startedAt&&!room.eventCancelled&&!pub.eventCancelled&&!room.systemClosed&&!pub.systemClosed&&
    !room.deletionStatus&&!pub.deletionStatus&&!room.testMode&&!pub.testMode,'expansion-room-unavailable');
   const state=parse(room.data),mirror=parse(pub.bracketView);
   requireThat(state?.id===roomId&&mirror?.id===roomId&&state.cloudCode===code&&mirror.cloudCode===code&&
    state.meta?.eventAuthority==='ticket'&&mirror.meta?.eventAuthority==='ticket'&&
    !state.startedAt&&!mirror.startedAt&&!state.rosterLocked&&!state.meta.eventCancelled&&!mirror.meta.eventCancelled&&
    !room.waitlistEnabled&&!pub.waitlistEnabled&&room.confirmedCount===pub.confirmedCount,'expansion-room-unavailable');
   const ticketRef=db.doc('commerceTickets/'+access.ticketId),ticket=(await tx.get(ticketRef)).data();
   requireThat(ticket?.version===2&&ticket.id===access.ticketId&&ticket.orderId===access.ticketId&&ticket.status==='reserved'&&
    ticket.ownerUid===uid&&ticket.boundRoomCode===code&&ticket.boundRoomId===roomId&&!ticket.usedAt&&ticket.expiresAt===null&&
    (ticket.contractCode||null)===grant.order,'ticket-binding-invalid');
   const before=capacityMatches({code,room,pub,state,mirror,ticket,maxCapacity:config.maxCapacity});
   requireThat(integer(room.confirmedCount,0,before)&&integer(quantity,1,config.maxCapacity-before),'invalid-expansion-capacity');
   requireThat(ent?.ownerUid===uid&&ent.kind===kind&&ent.assetId===assetId&&ent.status==='active'&&ent.expiresAt===null&&
    integer(ent.quantity,0,100000000)&&ent.quantity>=quantity,'insufficient-expansion-tickets');
   const after=before+quantity,balance=ent.quantity-quantity,added=access.addedCapacity+quantity;
   const updatedAt=Math.max(now,Number(state.updatedAt||0)+1,Number(room.updatedAt||0)+1,Number(pub.updatedAt||0)+1);
   requireThat(Number.isSafeInteger(updatedAt),'ticket-capacity-invalid');
   state.meta.registrationCapacity=after;mirror.meta.registrationCapacity=after;state.updatedAt=updatedAt;mirror.updatedAt=updatedAt;
   const result={ok:true,code,roomId,quantity,capacityBefore:before,capacityAfter:after,balanceBefore:ent.quantity,balanceAfter:balance};
   tx.update(roomRef,{capacity:after,ticketAccessV1:{...access,addedCapacity:added},data:JSON.stringify(state),updatedAt});
   tx.update(publicRef,{capacity:after,bracketView:JSON.stringify(mirror),updatedAt});
   tx.update(ticketRef,{addedCapacity:added,updatedAt});
   tx.update(entRef,{quantity:balance,lastUsedAt:now,updatedAt:now});
   tx.create(opRef,{actorUid:uid,action:'ticket-room-expand',requestHash:hash,result,createdAt:now});
   return result;
  });
 };
}
module.exports={capacityMatches,createTicketExpansionHandler};
