'use strict';
// The PTN callable supplies a verified ticket lifecycle context to the same
// three-seat transaction used by general and official rooms. No client role,
// owner UID or ticket state is accepted as authority.
const {createHandler}=require('../../referee-seats/functions/service.cjs');
const C=require('../../referee-seats/functions/core.cjs');
const {isPartnerRoomCode,resolveTicketGate,authorizeTicketManager,activeTicketManager,checkTicketContract}=require('./ticket-host.cjs');
const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');
const actions=new Set(['view','enable','find-invite-player','invite','create-qr','inspect-qr','accept-qr','accept-invite','claim','leave','revoke','request','respond','cancel']);
const ticketSeatReleaseEnabled=config=>config?.enabled===true&&config.perCourtScoringVerified===true&&config.ticketSeatsEnabled===true;
async function resolveTicketRefereeAuthority({db,enabled,tx,room,publicRoom,state,user,code,now}){
  if(!activeTicketManager(user)||!registrationQueueOwnsRoom(room)||!await enabled(code,tx))throw Error('permission-denied');
  const gate=await resolveTicketGate(db,code,tx);
  if(gate?.enabled!==true||gate.bindingEnabled!==true||typeof room?.ownerUid!=='string'||room.eventAuthority!=='ticket'||publicRoom?.eventAuthority!=='ticket'||publicRoom.ticketRoomVersion!==1||
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
}

// Scoped session: non-managers never receive the roster, delegate details,
// vouchers, full match history or other courts' player data.
function projectTicketRefereeView({room,state,user,uid,code,now,authority}){
 const {forfeitMatchAvailable,ticketMatchCourtAvailable,ticketRoundBlocked,ticketBronzeBlocked}=require('./lifecycle.cjs');
 const full=C.manager(room,user,uid,authority),support=['staff','admin','super_admin'].includes(user.role);
 const model=room.refereeSeatsV1?.version===1?room.refereeSeatsV1:null;
 const occupied=n=>C.SLOTS.some(slot=>model?.courts?.[n]?.[slot]?.uid===uid);
 const courts={};
 for(let n=1;n<=state.meta.stations;n++){
  const source=model?.courts?.[n]||{},closed=state.forcedCourtExits?.[n]?.closed===true||source.retired===true;
  if(!full&&!support&&(!occupied(n)||closed))continue;
  courts[n]={revision:Number(source.revision||0),closed,...Object.fromEntries(C.SLOTS.map(slot=>[slot,source[slot]?{uid:source[slot].uid,name:String(source[slot].name||'裁判').slice(0,80)}:null]))};
 }
 if(!Object.keys(courts).length)throw Error('not-event-staff');
 const names=new Map((state.players||[]).map(p=>[p.id,p.name]));
 const bracket=Object.keys(courts).map(key=>{
  const n=Number(key),court=courts[n],id=state.courtAssignments?.['court'+n]?.currentMatchId;
  const m=(state.matches||[]).find(x=>x.id===id&&Number(x.station)===n&&!x.completed&&!x.isBye&&x.a?.playerId&&x.b?.playerId&&!x.forceDetached);
  if(!m||court.closed)return null;
  return {id:m.id,seq:m.seq,round:m.round,station:n,status:m.status,scoreA:Number(m.scoreA||0),scoreB:Number(m.scoreB||0),
   a:{name:names.get(m.a.playerId)||'選手 A'},b:{name:names.get(m.b.playerId)||'選手 B'},updatedAt:Number(m.updatedAt||0),
   canScore:room.tournamentPhase==='live'&&court.main?.uid===uid&&forfeitMatchAvailable(m)&&ticketMatchCourtAvailable(state,m)&&!ticketRoundBlocked(m,state.matches,state.meta)&&!ticketBronzeBlocked(m,state.matches,state.meta)&&
    !['quick'].includes(m.scoringMode)&&!['quick'].includes(state.meta.scoringMode)};
 }).filter(Boolean);
 const requests=Object.values(model?.requests||{}).filter(r=>r.kind!=='qr'&&r.status==='pending'&&r.expiresAt>now&&courts[r.station]&&(r.fromUid===uid||r.toUid===uid))
  .map(r=>({id:r.id,kind:r.kind||'handoff',station:r.station,slot:r.slot,fromUid:r.fromUid,toUid:r.toUid,fromName:r.fromName||null,expiresAt:r.expiresAt}));
 return {ok:true,code,roomId:state.id,name:room.name||'合作賽事',phase:room.tournamentPhase,stations:state.meta.stations,updatedAt:Number(room.updatedAt||0),bracket,
  refereeSeatControl:{version:1,canInvite:C.ticketOwner(room,user,uid,authority),canJoin:support,canManage:full,courts,requests}};
}
function createTicketRefereeHandler({db,enabled=async()=>false,clock=Date.now,uuid}){
 const handle=createHandler(db,{clock,uuid,resolveTicketAuthority:args=>resolveTicketRefereeAuthority({...args,db,enabled}),projectTicketView:projectTicketRefereeView});
 return async request=>{
  const data=request.data;
  if(!request.auth?.uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  if(data?.action!=='ticket-room-referee'||!isPartnerRoomCode(data.code)||!actions.has(data.seatAction))throw Error('invalid-operation');
  const {seatAction,...fields}=data;
  return handle({...request,data:{...fields,action:seatAction}});
 };
}
module.exports={createTicketRefereeHandler,resolveTicketRefereeAuthority,ticketSeatReleaseEnabled,projectTicketRefereeView};
