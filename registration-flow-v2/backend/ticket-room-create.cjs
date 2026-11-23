'use strict';
const {forfeitMatchAvailable,ticketRoundBlocked,ticketBronzeBlocked}=require('./lifecycle.cjs');

const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {ticketHostGrant,checkTicketContract,isPartnerRoomCode,validRegistrationRoomCode,ticketLifecyclePath,authorizeTicketManager,activeTicketManager}=require('./ticket-host.cjs');
const {authorizeTicketRemoval}=require('./queue.cjs');

const fields=new Set(['action','code','ticketId','operationId','name','location','stations',
 'registrationOpenAt','registrationCloseAt','startAt']);
const roomIdPattern=/^[A-Za-z0-9_-]{8,100}$/;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ptnReleasePath='systemSettings/commerceTicketPtnPilotV1';

function requestData(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.has(key))||
    input.action!=='create-ticket-room'||(input.code!==undefined&&
      (!validRegistrationRoomCode(input.code)||isPartnerRoomCode(input.code)))||
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
 if(isPartnerRoomCode(code))common.hostName=grant.organizationName||'合作主辦';
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
  publicRoom:{...common,ticketRoomVersion:1,registrationQueueVersion:2,bracketView:JSON.stringify(state)}
 };
}

function createTicketRoomHandler({db,clock=Date.now,newPartnerCode=()=>`PTN-${randomBytes(3).toString('hex').toUpperCase()}`}){
 return async request=>{
  const uid=request.auth?.uid;
  if(typeof uid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(uid))throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const input=requestData(request.data),{ticketId,operationId}=input;
  const auto=input.code===undefined;
  const ticket=db.doc('commerceTickets/'+ticketId),order=db.doc('commerceOrders/'+ticketId);
  const release=db.doc(auto?ptnReleasePath:ticketLifecyclePath(input.code));
  const requestHash=digest(input);
  const attempt=candidate=>db.runTransaction(async tx=>{
   const now=clock();
   const [profileSnap,ticketSnap,orderSnap,gateSnap]=await tx.getAll(db.doc('users/'+uid),ticket,order,release);
   const grant=ticketHostGrant(profileSnap.data(),now);
   if(!grant)throw Error('permission-denied');
   const held=ticketSnap.data(),paid=orderSnap.data(),gate=gateSnap.data();
   if(auto&&(!gate||gate.ownerUid!==uid))throw Error('ticket-lifecycle-disabled');
   const code=auto?(gate.roomCode??candidate):input.code;
   if(auto&&!isPartnerRoomCode(code))throw Error('ticket-lifecycle-disabled');
   const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
   const receipt=room.collection('operationLog').doc('ticket-room-create-'+digest([uid,operationId]));
   const [roomSnap,publicSnap,receiptSnap]=await tx.getAll(room,pub,receipt);
   if(receiptSnap.exists){
    const prior=receiptSnap.data(),existing=roomSnap.data();
    if(prior.requestHash!==requestHash)throw Error('operation-conflict');
    if(!existing||publicSnap.data()?.ticketRoomVersion!==1||existing.ownerUid!==uid||
       existing.ticketAccessV1?.ticketId!==ticketId||existing.ticketAccessV1?.roomId!==prior.roomId||
       held?.boundRoomCode!==code||held?.boundRoomId!==prior.roomId)throw Error('room-receipt-inconsistent');
    return {ok:true,code,roomId:prior.roomId,replayed:true};
   }
   if(gate?.bindingEnabled!==true||gate.ownerUid!==uid)throw Error('ticket-lifecycle-disabled');
   if(auto){
    if(gate.enabled!==true)throw Error('ticket-lifecycle-disabled');
    if(gate.roomCode!=null||gate.roomId!=null)throw Error('ticket-ptn-slot-occupied');
   }else if(gate.roomCode!==code||!roomIdPattern.test(gate.roomId||''))throw Error('ticket-lifecycle-disabled');
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
   const roomId=auto?randomUUID():gate.roomId;
   const {privateRoom,publicRoom}=roomDocuments({input:{...input,code},capacity:held.capacity,owner:uid,grant,roomId,now});
   tx.create(room,privateRoom);
   tx.create(pub,publicRoom);
   tx.update(ticket,{status:'reserved',boundRoomCode:code,boundRoomId:roomId,updatedAt:now});
   if(auto)tx.update(release,{roomCode:code,roomId});
   tx.create(receipt,{requestHash,roomId});
   return {ok:true,code,roomId};
  });
  if(!auto)return attempt(input.code);
  for(let i=0;i<5;i++){
   try{return await attempt(newPartnerCode());}
   catch(error){if(error.message!=='room-code-conflict'||i===4)throw error;}
  }
 };
}
function createPtnStatusHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,data=request.data;
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  if(data?.action!=='ticket-ptn-status'||Object.keys(data).length!==1)throw Error('invalid-operation');
  const [actor,config]=await db.getAll(db.doc('users/'+uid),db.doc(ptnReleasePath));
  const gate=config.data();
  if(!ticketHostGrant(actor.data(),clock())||gate?.ownerUid!==uid||
     gate.bindingEnabled!==true||gate.enabled!==true)throw Error('permission-denied');
  if(gate.roomCode!=null&&!isPartnerRoomCode(gate.roomCode))throw Error('ticket-lifecycle-disabled');
  return {ok:true,code:gate.roomCode??null};
 };
}
function createTicketRoomStateHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid, data=request.data;
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  if(data?.action!=='ticket-room-state'||Object.keys(data).some(key=>!['action','code'].includes(key))||
     !validRegistrationRoomCode(data.code))throw Error('invalid-operation');
  const code=data.code;
  return db.runTransaction(async tx=>{
   const [actor,gateSnap,roomSnap]=await tx.getAll(db.doc('users/'+uid),
    db.doc(ticketLifecyclePath(code)),db.doc('tournaments/'+code));
   const gate=gateSnap.data(),room=roomSnap.data();
   if(gate?.bindingEnabled!==true&&gate?.enabled!==true)throw Error('ticket-lifecycle-disabled');
   if(!room)throw Error('not-found');
   const authority=await authorizeTicketManager(tx,db,{uid,user:actor.data(),room,gate,code,now:clock()});
   const state=JSON.parse(room.data);
   if(state.id!==gate.roomId)throw Error('ticket-binding-invalid');
   let ticketStatus;
   if(isPartnerRoomCode(code)){
    const ticketId=room.ticketAccessV1.ticketId;
    if(!/^BXH-SO-[A-Z0-9]{24}$/.test(ticketId))throw Error('ticket-binding-invalid');
    const ticket=(await tx.get(db.doc('commerceTickets/'+ticketId))).data();
    if(ticket?.ownerUid!==authority.ownerUid||ticket.boundRoomCode!==code||ticket.boundRoomId!==state.id||
       !['reserved','consumed'].includes(ticket.status))throw Error('ticket-binding-invalid');
    ticketStatus=ticket.status;
   }
   const rosterRevision=state.registrationRosterRevision??0;
   if(!Array.isArray(state.players)||!Number.isSafeInteger(rosterRevision)||rosterRevision<0)throw Error('ticket-binding-invalid');
   const eligibleCount=state.players.filter(player=>!state.meta?.checkinRequired||player.checkedIn===true).length;
   const names=new Map(state.players.map(player=>[player.id,player.name]));
   const matches=room.tournamentPhase==='live'&&!state.championId&&gate.enabled===true
    ?state.matches.filter(forfeitMatchAvailable).map(match=>({id:match.id,seq:match.seq,round:match.round,
     a:{id:match.a.playerId,name:names.get(match.a.playerId)||'選手 A'},
     b:{id:match.b.playerId,name:names.get(match.b.playerId)||'選手 B'},updatedAt:match.updatedAt||0})):[];
   const bracket=room.tournamentPhase==='live'&&Array.isArray(state.matches)?state.matches.map(match=>({
    id:match.id,seq:match.seq,round:match.round,bracket:match.bracket||null,station:match.station||null,
    status:match.status||'pending',isBye:!!match.isBye,completed:!!match.completed,
    a:match.a?.playerId?{id:match.a.playerId,name:names.get(match.a.playerId)||'選手 A'}:null,
    b:match.b?.playerId?{id:match.b.playerId,name:names.get(match.b.playerId)||'選手 B'}:null,
    scoreA:Number(match.scoreA||0),scoreB:Number(match.scoreB||0),winnerId:match.winnerId||null,
    updatedAt:match.updatedAt||0,
    canScore:gate.enabled===true&&!state.championId&&forfeitMatchAvailable(match)&&
     !['quick'].includes(match.scoringMode)&&!['quick'].includes(state.meta.scoringMode)&&
     !ticketRoundBlocked(match,state.matches,state.meta)&&
     !ticketBronzeBlocked(match,state.matches,state.meta)
   })):null;
   const delegate=room.ptnDelegateUid?(await tx.get(db.doc('users/'+room.ptnDelegateUid))).data():null;
   return {ok:true,code,roomId:state.id,name:room.name,location:room.location,
    ...(isPartnerRoomCode(code)?{delegateUid:room.ptnDelegateUid||null,
     delegateName:delegate?String(delegate.realName||delegate.displayName||'未設定姓名').slice(0,80):null,
     delegateGameId:delegate?String(delegate.gameId||'').slice(0,80):null,
     canAssignDelegate:authority.owner}:{}),
    capacity:room.capacity,confirmedCount:room.confirmedCount,phase:room.tournamentPhase,startAt:room.startAt,
    registrationOpenAt:room.registrationOpenAt,registrationCloseAt:room.registrationCloseAt,
    registrationEnabled:room.registrationEnabled,updatedAt:room.updatedAt,
    drawId:state.bracketDraw?.id??null,drawReady:state.bracketDraw?.rosterRevision===rosterRevision,rosterRevision,eligibleCount,
    ...(ticketStatus?{ticketStatus}:{}),...(room.tournamentPhase==='live'?{matches,bracket,
     championName:names.get(state.championId)||null}:{}),
    participants:room.tournamentPhase==='waiting'?state.players.filter(player=>player.source==='online'&&player.registrationId)
     .map(player=>({registrationId:player.registrationId,name:player.name})):[]};
  });
 };
}
function createTicketScheduleHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,data=request.data;
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  if(!data||Object.keys(data).some(key=>!['action','code','operationId','expectedUpdatedAt','registrationOpenAt','registrationCloseAt','startAt'].includes(key))||
     data.action!=='ticket-room-schedule'||!isPartnerRoomCode(data.code)||
     typeof data.operationId!=='string'||!roomIdPattern.test(data.operationId)||
     !Number.isSafeInteger(data.expectedUpdatedAt)||
     ![data.registrationOpenAt,data.registrationCloseAt,data.startAt].every(at=>Number.isSafeInteger(at)&&at>0)||
     !(data.registrationOpenAt<data.registrationCloseAt&&data.registrationCloseAt<=data.startAt))throw Error('invalid-operation');
  const {code,operationId,expectedUpdatedAt,registrationOpenAt,registrationCloseAt,startAt}=data;
  const roomRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const receipt=roomRef.collection('operationLog').doc('ticket-room-schedule-'+digest([uid,operationId]));
  const requestHash=digest(data);
  return db.runTransaction(async tx=>{
   const now=clock();
   const [actorSnap,gateSnap,roomSnap,publicSnap,receiptSnap]=await tx.getAll(
    db.doc('users/'+uid),db.doc(ticketLifecyclePath(code)),roomRef,publicRef,receipt);
   const gate=gateSnap.data(),room=roomSnap.data(),pub=publicSnap.data();
   const authority=await authorizeTicketManager(tx,db,{uid,user:actorSnap.data(),room,gate,code,now});
   const grant=authority.grant;
   if(gate.bindingEnabled!==true||gate.enabled!==true||pub?.ticketRoomVersion!==1)throw Error('permission-denied');
   if(receiptSnap.exists){
    if(receiptSnap.data().requestHash!==requestHash)throw Error('operation-conflict');
    return {ok:true,replayed:true};
   }
   if(room.tournamentPhase!=='waiting')throw Error('tournament-started');
   if(room.updatedAt!==expectedUpdatedAt)throw Error('version-conflict');
   if(registrationCloseAt<=now||startAt<=now||startAt>=grant.expiresAt)throw Error('invalid-operation');
   const ticketSnap=await tx.get(db.doc('commerceTickets/'+room.ticketAccessV1.ticketId));
   const ticket=ticketSnap.data();
   if(ticket?.ownerUid!==authority.ownerUid||ticket.status!=='reserved'||ticket.boundRoomCode!==code||
      ticket.boundRoomId!==gate.roomId||startAt>=ticket.expiresAt)throw Error('ticket-binding-invalid');
   const state=JSON.parse(room.data),publicState=JSON.parse(pub.bracketView);
   if(state.id!==gate.roomId||publicState.id!==gate.roomId)throw Error('ticket-binding-invalid');
   const revision=Math.max(now,room.updatedAt+1);
   const schedule={registrationOpenAt,registrationCloseAt,startAt,cancellationDeadline:registrationCloseAt,
    registrationStatus:registrationOpenAt<=now?'open':'upcoming',updatedAt:revision};
   Object.assign(state.meta,schedule);
   Object.assign(publicState.meta,schedule);
   tx.update(roomRef,{...schedule,data:JSON.stringify({...state,updatedAt:revision})});
   tx.update(publicRef,{...schedule,bracketView:JSON.stringify({...publicState,updatedAt:revision})});
   tx.create(receipt,{requestHash,updatedAt:revision});
   return {ok:true};
  });
 };
}
function createTicketDelegateSearchHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,data=request.data;
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  if(data?.action!=='ticket-room-delegate-search'||Object.keys(data).some(k=>!['action','code','query'].includes(k))||
     !isPartnerRoomCode(data.code)||typeof data.query!=='string'||data.query.trim().length<2||data.query.trim().length>80)throw Error('invalid-operation');
  const code=data.code,query=data.query.trim();
  return db.runTransaction(async tx=>{
   const [actorSnap,roomSnap,gateSnap]=await tx.getAll(db.doc('users/'+uid),db.doc('tournaments/'+code),db.doc(ticketLifecyclePath(code)));
   const gate=gateSnap.data();
   const authority=await authorizeTicketManager(tx,db,{uid,user:actorSnap.data(),room:roomSnap.data(),gate,code,now:clock()});
   if(!authority.owner||gate.enabled!==true||gate.bindingEnabled!==true)throw Error('permission-denied');
   const rows=new Map();
   for(const field of ['realName','displayName','gameId']){
    const found=await tx.get(db.collection('users').where(field,'==',query).limit(6));
    for(const row of found.docs){
     const player=row.data();
     if(row.id!==uid&&activeTicketManager(player)&&player.role==='player')rows.set(row.id,{
      uid:row.id,name:String(player.realName||player.displayName||'未設定姓名').slice(0,80),
      gameId:String(player.gameId||'').slice(0,80)});
    }
   }
   return {ok:true,players:[...rows.values()].slice(0,10)};
  });
 };
}
function createTicketDelegateHandler({db,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,data=request.data;
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  if(data?.action!=='ticket-room-delegate'||Object.keys(data).some(k=>!['action','code','delegateUid','operationId'].includes(k))||
     (data.operationId!==undefined&&(typeof data.operationId!=='string'||!roomIdPattern.test(data.operationId)))||
     !isPartnerRoomCode(data.code)||(data.delegateUid!==null&&
       (typeof data.delegateUid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(data.delegateUid))))throw Error('invalid-operation');
  const {code,delegateUid}=data;
  return db.runTransaction(async tx=>{
   const roomRef=db.doc('tournaments/'+code);
   const [actorSnap,roomSnap,gateSnap]=await tx.getAll(db.doc('users/'+uid),roomRef,db.doc(ticketLifecyclePath(code)));
   const room=roomSnap.data(),gate=gateSnap.data();
   const authority=await authorizeTicketManager(tx,db,{uid,user:actorSnap.data(),room,gate,code,now:clock()});
   if(!authority.owner||gate.enabled!==true||gate.bindingEnabled!==true)throw Error('permission-denied');
   if(delegateUid){
    if(delegateUid===uid)throw Error('invalid-operation');
    const candidate=(await tx.get(db.doc('users/'+delegateUid))).data();
    if(!activeTicketManager(candidate)||candidate.role!=='player')throw Error('permission-denied');
   }
   tx.update(roomRef,{ptnDelegateUid:delegateUid});
   return {ok:true,delegateUid};
  });
 };
}
function createTicketRemoveHandler({db,queue,enabled,clock=Date.now}){
 return async request=>{
  if(!request.auth?.uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const input=request.data;
  if(input?.action!=='ticket-room-remove'||Object.keys(input).some(k=>!['action','code','operationId','registrationId'].includes(k))||
     typeof input.registrationId!=='string'||!(/^[A-Za-z0-9_-]{1,128}$/).test(input.registrationId))throw Error('invalid-operation');
  const {code,operationId,registrationId}=input;
  if(!await enabled(code))throw Error('registration-queue-disabled');
  return queue.enqueue(request.auth.uid,{code,operationId,route:'family',payload:{code,operationId,registrationId,
   action:'cancel',intent:'ticket-host'}},(tx,user,operation,room)=>authorizeTicketRemoval(tx,db,user,operation,room,clock()));
 };
}
module.exports={createTicketRoomHandler,createPtnStatusHandler,createTicketRoomStateHandler,createTicketScheduleHandler,createTicketRemoveHandler,createTicketDelegateHandler,createTicketDelegateSearchHandler};
