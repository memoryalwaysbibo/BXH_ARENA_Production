'use strict';
// The PTN callable supplies a verified ticket lifecycle context to the same
// three-seat transaction used by general and official rooms. No client role,
// owner UID or ticket state is accepted as authority.
const {createHandler}=require('../../referee-seats/functions/service.cjs');
const {isPartnerRoomCode,resolveTicketGate,authorizeTicketManager,activeTicketManager,checkTicketContract}=require('./ticket-host.cjs');
const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');
const actions=new Set(['enable','find-invite-player','invite','create-qr','inspect-qr','accept-qr','accept-invite','claim','leave','revoke','request','respond','cancel']);
function createTicketRefereeHandler({db,enabled=async()=>false,clock=Date.now,uuid}){
 const handle=createHandler(db,{clock,uuid,resolveTicketAuthority:async({tx,room,publicRoom,state,user,code,now})=>{
  if(!activeTicketManager(user)||!registrationQueueOwnsRoom(room)||!await enabled(code,tx))throw Error('permission-denied');
  const gate=await resolveTicketGate(db,code,tx);
  if(gate?.enabled!==true||gate.bindingEnabled!==true||room.eventAuthority!=='ticket'||publicRoom?.eventAuthority!=='ticket'||publicRoom.ticketRoomVersion!==1||
     room.ticketAccessV1?.version!==1||state.id!==gate.roomId||room.ticketAccessV1.roomId!==state.id)throw Error('ticket-binding-invalid');
  const owner=(await tx.get(db.doc('users/'+room.ownerUid))).data();
  const authority=await authorizeTicketManager(tx,db,{uid:room.ownerUid,user:owner,room,gate,code,now});
  if(authority.grant.order)checkTicketContract((await tx.get(db.doc('partnerContracts/'+authority.grant.order))).data(),authority.grant,authority.ownerUid);
  const ticketId=room.ticketAccessV1.ticketId;
  if(typeof ticketId!=='string'||!/^BXH-SO-[A-Z0-9]{24}$/.test(ticketId))throw Error('ticket-binding-invalid');
  const ticket=(await tx.get(db.doc('commerceTickets/'+ticketId))).data();
  let mirror;try{mirror=JSON.parse(publicRoom.bracketView);}catch{throw Error('ticket-binding-invalid');}
  const phase=room.tournamentPhase;
  if(!['waiting','live'].includes(phase)||publicRoom.tournamentPhase!==phase||state.championId||state.completedAt||
     [room,publicRoom,state].some(d=>d.eventCancelled||d.systemClosed||d.deletionStatus||['completed','archived'].includes(d.archiveStatus)||'scoreStorage' in d||'scoreBucketProjection' in d)||
     state.meta?.eventCancelled||state.meta?.eventAuthority!=='ticket'||state.meta?.formatType!=='single'||state.meta?.battleMode!=='individual'||
     (phase==='waiting'?(state.startedAt||mirror.startedAt):(!state.startedAt||!mirror.startedAt||!state.rosterLocked)))throw Error('room-read-only');
  if(ticket?.ownerUid!==authority.ownerUid||ticket.boundRoomCode!==code||ticket.boundRoomId!==state.id||ticket.status!==(phase==='waiting'?'reserved':'consumed')||mirror.id!==state.id||mirror.meta?.stations!==state.meta.stations||
     !Number.isInteger(state.meta.stations)||state.meta.stations<1||state.meta.stations>12)throw Error('ticket-binding-invalid');
  return {enabled:true,ownerUid:authority.ownerUid,roomId:state.id};
 }});
 return async request=>{
  const data=request.data;
  if(!request.auth?.uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  if(data?.action!=='ticket-room-referee'||!isPartnerRoomCode(data.code)||!actions.has(data.seatAction))throw Error('invalid-operation');
  const {seatAction,...fields}=data;
  return handle({...request,data:{...fields,action:seatAction}});
 };
}
module.exports={createTicketRefereeHandler};
