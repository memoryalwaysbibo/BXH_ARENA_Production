'use strict';
const {forfeitMatchAvailable,ticketRoundBlocked,ticketBronzeBlocked,ticketMatchCourtAvailable,projectTicketCourtState,ticketCourtSummary,ticketCanSkip}=require('./lifecycle.cjs');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const Fault=require('../../referee-seats/functions/engine/fault.cjs');
const PassReturn=require('../../referee-seats/functions/engine/pass-return.cjs').BXHPassReturn;
const {BXHCourtRetirement:R}=require('../../referee-seats/functions/engine/court-retirement.cjs');
const {signature}=require('../../modules/main-app/bracket-commit.js');

const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {ticketHostGrant,checkTicketContract,isPartnerRoomCode,validRegistrationRoomCode,ticketLifecyclePath,resolveTicketGate,authorizeTicketManager,activeTicketManager}=require('./ticket-host.cjs');
const {authorizeTicketRemoval}=require('./queue.cjs');
const {resolveTicketRefereeAuthority,ticketSeatReleaseEnabled,projectTicketRefereeView}=require('./ticket-referee-seat.cjs');
const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');
const {advance:advanceQrCheckinFence}=require('../../qr-checkin/backend/qr-checkin-fence.cjs');

const fields=new Set(['action','code','ticketId','operationId','name','location','stations',
 'registrationOpenAt','registrationCloseAt','startAt']);
const roomIdPattern=/^[A-Za-z0-9_-]{8,100}$/;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ptnReleasePath='systemSettings/commerceTicketPtnPilotV1';
const ptnSalePath='systemSettings/commerceTicketPtnSaleV1';
const ptnPrices=Object.freeze({'32':300,'64':600,'96':1000,'128':1500,'160':2000});

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

function createSaleTicketRoomHandler({db,clock,newPartnerCode}){
 return async request=>{
  const uid=request.auth?.uid;
  if(typeof uid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(uid))throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const input=requestData(request.data);
  if(input.code!==undefined)throw Error('invalid-operation');
  const {ticketId,operationId}=input,requestHash=digest(input);
  const ticketRef=db.doc('commerceTickets/'+ticketId),orderRef=db.doc('commerceOrders/'+ticketId);
  const saleRef=db.doc(ptnSalePath),indexRef=db.doc('commerceTicketHostIndex/'+uid);
  const operationRef=db.doc('commerceTicketRoomCreateOps/'+digest([uid,operationId]));
  const attempt=candidate=>db.runTransaction(async tx=>{
   const now=clock();
   const [actor,ticketSnap,orderSnap,saleSnap,operationSnap,indexSnap]=await tx.getAll(
    db.doc('users/'+uid),ticketRef,orderRef,saleRef,operationRef,indexRef);
   const grant=ticketHostGrant(actor.data(),now),ticket=ticketSnap.data(),order=orderSnap.data(),sale=saleSnap.data();
   if(!grant)throw Error('permission-denied');
   if(sale?.enabled!==true)throw Error('ticket-lifecycle-disabled');
   const code=operationSnap.exists?operationSnap.data().code:candidate;
   if(!isPartnerRoomCode(code))throw Error('room-code-conflict');
   const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),gateRef=db.doc('commerceTicketRoomGates/'+code);
   const receipt=room.collection('operationLog').doc('ticket-room-create-'+digest([uid,operationId]));
   const [roomSnap,pubSnap,gateSnap,receiptSnap]=await tx.getAll(room,pub,gateRef,receipt);
   if(operationSnap.exists){
    const prior=operationSnap.data(),existing=roomSnap.data();
    if(prior.ownerUid!==uid||prior.ticketId!==ticketId||prior.requestHash!==requestHash||
       !receiptSnap.exists||receiptSnap.data().requestHash!==requestHash||
       receiptSnap.data().roomId!==prior.roomId||existing?.ownerUid!==uid||
       existing.ticketAccessV1?.ticketId!==ticketId||gateSnap.data()?.roomId!==prior.roomId||
       ticket?.boundRoomCode!==code||ticket?.boundRoomId!==prior.roomId)throw Error('operation-conflict');
    return {ok:true,code,roomId:prior.roomId,replayed:true};
   }
   if(roomSnap.exists||pubSnap.exists||gateSnap.exists)throw Error('room-code-conflict');
   const spec=order?.productSnapshot?.delivery,capacity=Number(spec?.assetId);
   if(order?.id!==ticketId||order.ownerUid!==uid||order.ticketPurchaseVersion!==3||
      order.paymentStatus!=='paid'||order.deliveryStatus!=='delivered'||
      order.ticketOrganizationId!==grant.organizationId||(order.contractCode||null)!==grant.order||
      spec?.kind!=='ticket'||spec?.quantity!==1||spec?.durationDays!==0||
      sale.productIds?.[spec.assetId]!==order.productSnapshot.id||
      ptnPrices[spec.assetId]!==order.amountTwd||
      ticket?.version!==2||ticket.id!==ticketId||ticket.orderId!==ticketId||
      ticket.ownerUid!==uid||ticket.status!=='available'||ticket.usedAt||
      ticket.boundRoomCode!==null||ticket.boundRoomId!=null||ticket.expiresAt!==null||
      ticket.capacity!==capacity||ticket.addedCapacity!==0||
      (ticket.contractCode||null)!==grant.order)throw Error('ticket-binding-invalid');
   if(input.registrationCloseAt<=now||input.startAt<=now||input.startAt>=grant.expiresAt)throw Error('invalid-operation');
   if(grant.order)checkTicketContract((await tx.get(db.doc('partnerContracts/'+grant.order))).data(),grant,uid);
   const roomId=randomUUID();
   const {privateRoom,publicRoom}=roomDocuments({input:{...input,code},capacity,owner:uid,grant,roomId,now});
   tx.create(room,{...privateRoom,ptnSettlementVersion:1});
   tx.create(pub,{...publicRoom,ptnSettlementVersion:1});
   tx.create(gateRef,{enabled:true,bindingEnabled:true,ownerUid:uid,roomCode:code,roomId,ticketId,createdAt:now});
   tx.update(ticketRef,{status:'reserved',boundRoomCode:code,boundRoomId:roomId,updatedAt:now});
   tx.set(indexRef,{ownerUid:uid,latestRoomCode:code,updatedAt:now},{merge:true});
   tx.create(operationRef,{ownerUid:uid,ticketId,requestHash,code,roomId,at:now});
   tx.create(receipt,{requestHash,roomId});
   return {ok:true,code,roomId};
  });
  for(let i=0;i<5;i++){
   try{return await attempt(newPartnerCode());}
   catch(error){if(error.message!=='room-code-conflict'||i===4)throw error;}
  }
 };
}

function createTicketRoomHandler({db,clock=Date.now,newPartnerCode=()=>`PTN-${randomBytes(3).toString('hex').toUpperCase()}`}){
 const saleCreate=createSaleTicketRoomHandler({db,clock,newPartnerCode});
 return async request=>{
  const uid=request.auth?.uid;
  if(typeof uid!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(uid))throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const input=requestData(request.data),{ticketId,operationId}=input;
  const auto=input.code===undefined;
  const ticket=db.doc('commerceTickets/'+ticketId),order=db.doc('commerceOrders/'+ticketId);
  if(auto&&(await order.get()).data()?.ticketPurchaseVersion===3)return saleCreate(request);
  const release=db.doc(auto?ptnReleasePath:ticketLifecyclePath(input.code));
  const requestHash=digest(input);
  const createOperation=auto?db.doc('commerceTicketRoomCreateOps/'+digest([uid,operationId])):null;
  const attempt=candidate=>db.runTransaction(async tx=>{
   const now=clock();
   const [profileSnap,ticketSnap,orderSnap,gateSnap,createSnap]=await tx.getAll(db.doc('users/'+uid),ticket,order,release,...(auto?[createOperation]:[]));
   const grant=ticketHostGrant(profileSnap.data(),now);
   if(!grant)throw Error('permission-denied');
   const held=ticketSnap.data(),paid=orderSnap.data(),gate=gateSnap.data();
   if(auto&&(!gate||gate.ownerUid!==uid))throw Error('ticket-lifecycle-disabled');
   const legacyReceipt=auto&&gate?.roomCode
    ?await tx.get(db.doc('tournaments/'+gate.roomCode).collection('operationLog').doc('ticket-room-create-'+digest([uid,operationId])))
    :null;
   const code=auto?(createSnap?.data()?.code|| (legacyReceipt?.exists?gate.roomCode:candidate)):input.code;
   if(auto&&!isPartnerRoomCode(code))throw Error('ticket-lifecycle-disabled');
   const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
   const receipt=room.collection('operationLog').doc('ticket-room-create-'+digest([uid,operationId]));
   const [roomSnap,publicSnap,receiptSnap]=await tx.getAll(room,pub,receipt);
   if(receiptSnap.exists||createSnap?.exists){
    const prior=receiptSnap.data(),existing=roomSnap.data();
    if(prior?.requestHash!==requestHash||createSnap?.exists&&
       (createSnap.data().requestHash!==requestHash||createSnap.data().code!==code||createSnap.data().roomId!==prior?.roomId))throw Error('operation-conflict');
    if(!existing||publicSnap.data()?.ticketRoomVersion!==1||existing.ownerUid!==uid||
       existing.ticketAccessV1?.ticketId!==ticketId||existing.ticketAccessV1?.roomId!==prior.roomId||
       held?.boundRoomCode!==code||held?.boundRoomId!==prior.roomId)throw Error('room-receipt-inconsistent');
    return {ok:true,code,roomId:prior.roomId,replayed:true};
   }
   if(gate?.bindingEnabled!==true||gate.ownerUid!==uid)throw Error('ticket-lifecycle-disabled');
   if(auto){
    if(gate.enabled!==true)throw Error('ticket-lifecycle-disabled');
    if(Object.keys(gate.rooms||{}).length>=8)throw Error('ticket-ptn-slot-occupied');
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
   if(auto){
    const rooms={...(gate.rooms||{}),[code]:{roomId,ownerUid:uid}};
    tx.update(release,{rooms,latestRoomCode:code,...(gate.roomCode?{}:{roomCode:code,roomId})});
    tx.create(createOperation,{requestHash,code,roomId,ticketId,ownerUid:uid,at:now});
   }
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
  const [actor,config,index,sale]=await db.getAll(db.doc('users/'+uid),db.doc(ptnReleasePath),
   db.doc('commerceTicketHostIndex/'+uid),db.doc(ptnSalePath));
  const gate=config.data();
  if(!ticketHostGrant(actor.data(),clock()))throw Error('permission-denied');
  if(sale.data()?.enabled===true){
   const latest=index.data()?.ownerUid===uid?index.data().latestRoomCode:null;
   if(latest!=null&&!isPartnerRoomCode(latest))throw Error('ticket-lifecycle-disabled');
   return {ok:true,code:latest,canCreate:true};
  }
  if(gate?.ownerUid!==uid||gate.bindingEnabled!==true||gate.enabled!==true)throw Error('permission-denied');
  if(gate.roomCode!=null&&!isPartnerRoomCode(gate.roomCode))throw Error('ticket-lifecycle-disabled');
  const latest=gate.latestRoomCode??gate.roomCode??null;
  if(latest&&!isPartnerRoomCode(latest))throw Error('ticket-lifecycle-disabled');
  return {ok:true,code:latest,canCreate:Object.keys(gate.rooms||{}).length<8};
 };
}
// A display-only projection from the same authoritative seat model used by
// the shared referee service. This label-only view contains no account
// identifiers, requests or tokens. Interactive controls are independently authorized.
function projectTicketRefereeSeatNames(room,stations){
 const model=room.refereeSeatsV1;
 if(model?.version!==1||!model.courts||!Number.isInteger(stations)||stations<1||stations>12)return null;
 const courts={};
 for(let station=1;station<=stations;station++){
  const court=model.courts[station]||{};
  courts[station]=Object.fromEntries(['main','backup1','backup2'].map(slot=>{
   const name=court[slot]?.name;
   return [slot,typeof name==='string'&&name.trim()?{name:name.trim().slice(0,80)}:null];
  }));
 }
 return {version:1,courts};
}
function createTicketRoomStateHandler({db,enabled=async()=>false,clock=Date.now}){
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
   const gate=await resolveTicketGate(db,code,tx,gateSnap.data()),room=roomSnap.data();
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
   // The committed draw can be previewed by an authorized manager before start.
   const bracketVisible=['live','settling','done'].includes(room.tournamentPhase)||
    room.tournamentPhase==='waiting'&&!!state.bracketDraw?.id;
   const matches=room.tournamentPhase==='live'&&!state.championId&&gate.enabled===true
    ?state.matches.filter(match=>forfeitMatchAvailable(match)&&ticketMatchCourtAvailable(state,match)).map(match=>({id:match.id,seq:match.seq,round:match.round,
     a:{id:match.a.playerId,name:names.get(match.a.playerId)||'選手 A'},
     b:{id:match.b.playerId,name:names.get(match.b.playerId)||'選手 B'},updatedAt:match.updatedAt||0})):[];
   const bracket=bracketVisible&&Array.isArray(state.matches)?state.matches.map(match=>({
    id:match.id,seq:match.seq,round:match.round,bracket:match.bracket||null,station:match.station||null,
    status:match.status||'pending',isBye:!!match.isBye,completed:!!match.completed,
    a:match.a?.playerId?{id:match.a.playerId,name:names.get(match.a.playerId)||'選手 A'}:null,
    b:match.b?.playerId?{id:match.b.playerId,name:names.get(match.b.playerId)||'選手 B'}:null,
    scoreA:Number(match.scoreA||0),scoreB:Number(match.scoreB||0),winnerId:match.winnerId||null,
    faultActions:Fault.snapshot(match),standardControls:true,canSkip:ticketCanSkip(state,match),scoreLog:(match.log||[]).map(l=>({side:l.side,type:l.type,points:l.points})),
    updatedAt:match.updatedAt||0,
    canScore:room.tournamentPhase==='live'&&gate.enabled===true&&!state.championId&&forfeitMatchAvailable(match)&&ticketMatchCourtAvailable(state,match)&&
     !['quick'].includes(match.scoringMode)&&!['quick'].includes(state.meta.scoringMode)&&
     !ticketRoundBlocked(match,state.matches,state.meta)&&
     !ticketBronzeBlocked(match,state.matches,state.meta)
   })):null;
   // A capability advertised only by the matching live backend. Older backend
   // responses keep the frontend's original read-only live settings.
   const courtControl=isPartnerRoomCode(code)&&room.tournamentPhase==='live'&&ticketStatus==='consumed'&&gate.enabled===true&&
    state.startedAt&&state.rosterLocked&&!state.championId&&!state.meta?.eventCancelled&&
    ![room,state].some(doc=>doc.systemClosed||doc.eventCancelled||doc.deletionStatus||['completed','archived'].includes(doc.archiveStatus)||'scoreStorage' in doc||'scoreBucketProjection' in doc)&&
    state.meta?.formatType==='single'&&state.meta?.battleMode==='individual'&&Number.isInteger(state.meta.stations)&&state.meta.stations>=1&&state.meta.stations<=12&&await enabled(code,tx)
    ?{version:1,targetCount:R.target(state),courts:Array.from({length:state.meta.stations},(_,i)=>{
     const station=i+1,closed=state.forcedCourtExits?.[station]?.closed===true,currentMatchId=state.courtAssignments?.['court'+station]?.currentMatchId||null;
     return {station,closed,draining:station>R.target(state),currentMatchId,...ticketCourtSummary(state,station)};
    }),detached:state.matches.filter(m=>!m.completed&&m.forceDetached&&Number(m.station)===0).map(m=>m.id),
    deferred:state.matches.filter(m=>PassReturn.supported(state)&&PassReturn.readiness(state,m,{manual:true}).ok&&!m.resumeQueuedAt&&!ticketRoundBlocked(m,state.matches,state.meta)&&!ticketBronzeBlocked(m,state.matches,state.meta)).map(m=>m.id)}:null;
   let refereeSeatControl=null;
   if(isPartnerRoomCode(code)&&['waiting','live'].includes(room.tournamentPhase)&&!state.championId&&gate.enabled===true&&await enabled(code,tx)&&
    ticketSeatReleaseEnabled((await tx.get(db.doc('systemConfig/refereeSeatsV1'))).data())){
    const publicRoom=(await tx.get(db.doc('publicTournaments/'+code))).data();
    try{
     const ticket=await resolveTicketRefereeAuthority({db,enabled,tx,room,publicRoom,state,user:actor.data(),code,now:clock()});
     refereeSeatControl=projectTicketRefereeView({room,state,user:actor.data(),uid,code,now:clock(),authority:{ticket}}).refereeSeatControl;
    }catch(error){if(!['room-read-only','permission-denied','ticket-binding-invalid'].includes(error.message))throw error;}
   }
   const delegate=room.ptnDelegateUid?(await tx.get(db.doc('users/'+room.ptnDelegateUid))).data():null;
   return {ok:true,code,roomId:state.id,name:room.name,location:room.location,
    ...(isPartnerRoomCode(code)?{delegateUid:room.ptnDelegateUid||null,
     delegateName:delegate?String(delegate.realName||delegate.displayName||'未設定姓名').slice(0,80):null,
     delegateGameId:delegate?String(delegate.gameId||'').slice(0,80):null,
     canAssignDelegate:authority.owner,refereeSeatView:projectTicketRefereeSeatNames(room,state.meta?.stations)}:{}),
    capacity:room.capacity,confirmedCount:room.confirmedCount,phase:room.tournamentPhase,startAt:room.startAt,
    stations:Number.isInteger(state.meta?.stations)&&state.meta.stations>=1&&state.meta.stations<=12?state.meta.stations:null,
    registrationOpenAt:room.registrationOpenAt,registrationCloseAt:room.registrationCloseAt,
    registrationEnabled:room.registrationEnabled,updatedAt:room.updatedAt,
    drawId:state.bracketDraw?.id??null,drawReady:state.bracketDraw?.rosterRevision===rosterRevision,rosterRevision,eligibleCount,
    ...(ticketStatus?{ticketStatus}:{}),...(refereeSeatControl?{refereeSeatControl}:{}),...(courtControl?{courtControl}:{}),...(bracketVisible?{matches,bracket,
     championName:names.get(state.championId)||null}:{}),
    participants:state.players.filter(player=>player.source==='online'&&player.registrationId)
     .map(player=>({name:player.name,...(room.tournamentPhase==='waiting'?{registrationId:player.registrationId}:{})}))};
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
   const gate=await resolveTicketGate(db,code,tx,gateSnap.data()),room=roomSnap.data(),pub=publicSnap.data();
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
      ticket.boundRoomId!==gate.roomId||ticket.version===1&&startAt>=ticket.expiresAt||
      ticket.version===2&&ticket.expiresAt!==null)throw Error('ticket-binding-invalid');
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
// Keep the committed draw intact. A pre-start station resize only changes routing.
function createTicketStationsHandler({db,enabled=async()=>false,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,data=request.data;
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const command=data?.command??'resize';
  const commandFields={resize:['stations'],exit:['station','matchId'],claim:['station','matchId'],'claim-skipped':['station','matchId'],reopen:['station']};
  const stationValid=n=>Number.isInteger(n)&&n>=1&&n<=12;
  const matchValid=id=>typeof id==='string'&&id.length>0&&id.length<=128;
  if(!data||!Object.hasOwn(commandFields,command)||Object.keys(data).some(key=>!['action','code','roomId','operationId','expectedUpdatedAt','command',...commandFields[command]].includes(key))||
     data.action!=='ticket-room-stations'||!isPartnerRoomCode(data.code)||
     typeof data.roomId!=='string'||!roomIdPattern.test(data.roomId)||
     typeof data.operationId!=='string'||!roomIdPattern.test(data.operationId)||
     !Number.isSafeInteger(data.expectedUpdatedAt)||
     (command==='resize'?!stationValid(data.stations):!stationValid(data.station))||
     (command==='exit'&&data.matchId!==null&&!matchValid(data.matchId))||
     (['claim','claim-skipped'].includes(command)&&!matchValid(data.matchId)))throw Error('invalid-operation');
  const {code,roomId,operationId,expectedUpdatedAt,stations,station,matchId}=data;
  const roomRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const receipt=roomRef.collection('operationLog').doc('ticket-room-stations-'+digest([uid,operationId]));
  const requestHash=digest(data);
  return db.runTransaction(async tx=>{
   const now=clock();
   const [actorSnap,gateSnap,roomSnap,publicSnap,receiptSnap]=await tx.getAll(db.doc('users/'+uid),db.doc(ticketLifecyclePath(code)),roomRef,publicRef,receipt);
   const gate=await resolveTicketGate(db,code,tx,gateSnap.data()),room=roomSnap.data(),pub=publicSnap.data();
   const authority=await authorizeTicketManager(tx,db,{uid,user:actorSnap.data(),room,gate,code,now});
   if(gate.bindingEnabled!==true||gate.enabled!==true||pub?.ticketRoomVersion!==1)throw Error('permission-denied');
   const state=JSON.parse(room.data),mirror=JSON.parse(pub.bracketView);
   if(state.id!==roomId||mirror.id!==roomId||gate.roomId!==roomId)throw Error('ticket-binding-invalid');
   if(receiptSnap.exists){
    if(receiptSnap.data().requestHash!==requestHash)throw Error('operation-conflict');
    return {ok:true,replayed:true};
   }
   // Live operations reuse the established retirement engine and are committed
   // atomically with the public routing view. The reserved-ticket path below is unchanged.
   if(room.tournamentPhase==='live'&&pub.tournamentPhase==='live'){
    if(!registrationQueueOwnsRoom(room)||!await enabled(code,tx)||!state.startedAt||!mirror.startedAt||!state.rosterLocked||state.championId||
       [room,pub,state].some(doc=>doc.systemClosed||doc.eventCancelled||doc.deletionStatus||['completed','archived'].includes(doc.archiveStatus)||'scoreStorage' in doc||'scoreBucketProjection' in doc)||
       state.meta?.eventCancelled||state.meta?.eventAuthority!=='ticket'||pub.eventAuthority!=='ticket'||state.meta?.formatType!=='single'||state.meta?.battleMode!=='individual')throw Error('court-room-not-live');
    if(room.updatedAt!==expectedUpdatedAt)throw Error('version-conflict');
    const ticket=(await tx.get(db.doc('commerceTickets/'+room.ticketAccessV1.ticketId))).data();
    if(ticket?.ownerUid!==authority.ownerUid||ticket.status!=='consumed'||ticket.boundRoomCode!==code||ticket.boundRoomId!==roomId)throw Error('ticket-binding-invalid');
    if(!Array.isArray(state.matches)||!Array.isArray(mirror.matches)||signature(state)!==signature(mirror)||!stationValid(state.meta.stations)||mirror.meta?.stations!==state.meta.stations)throw Error('bracket-version-conflict');
    if(command==='resize'&&stations===R.target(state)){
     tx.create(receipt,{requestHash,updatedAt:room.updatedAt});return {ok:true};
    }
    const previousStations=state.meta.stations;
    const revision=Math.max(now,room.updatedAt+1,Number(state.updatedAt||0)+1);
    let result;
    if(command==='resize')result=R.request(state,stations,R.target(state),revision);
    else if(command==='exit'){
     const match=state.matches.find(m=>m.id===matchId);
     result=R.forceExit(state,station,matchId,Number(match?.dispatchRevision||0),Number(state.forcedCourtExits?.[station]?.revision||0),revision);
    }else if(command==='claim'){
     const match=state.matches.find(m=>m.id===matchId);
     result=R.claimDetached(state,matchId,station,Number(match?.dispatchRevision||0),revision);
    }else if(command==='claim-skipped'){
     const match=state.matches.find(m=>m.id===matchId);
     if(!PassReturn.supported(state)||!match?.skippedAt||match.resumeQueuedAt||!PassReturn.readiness(state,match,{manual:true}).ok)throw Error('dispatch-stale');
     if(ticketRoundBlocked(match,state.matches,state.meta)||ticketBronzeBlocked(match,state.matches,state.meta))throw Error('score-round-waiting');
     if(!R.accepts(state,station))throw Error('target-retiring');
     result=createEngine(state,{uid},revision,operationId).applySkippedDispatch(state,match,station,Number(match.dispatchRevision||0));
    }else result=R.reopen(state,station,Number(state.forcedCourtExits?.[station]?.revision||0),revision);
    if(!result.ok)throw Error(result.reason);
    // Rebuild only routing, not settlement or score ledgers.
    createEngine(state,{uid},revision,operationId).rebuildCourtAssignments();
    const courtFields=projectTicketCourtState(room,state,mirror,authority.ownerUid,previousStations,revision,command==='claim-skipped');
    const fence=room.qrCheckinManaged===true?advanceQrCheckinFence(room,state):{};
    tx.update(roomRef,{...fence,...courtFields,updatedAt:revision,data:JSON.stringify({...state,updatedAt:revision})});
    tx.update(publicRef,{...fence,updatedAt:revision,bracketView:JSON.stringify({...mirror,updatedAt:revision})});
    tx.create(receipt,{requestHash,updatedAt:revision});
    return {ok:true};
   }
   if(command!=='resize')throw Error('court-room-not-live');
   if([room,pub].some(doc=>doc.tournamentPhase!=='waiting'||doc.startedAt||doc.eventCancelled||doc.systemClosed)||state.startedAt||mirror.startedAt||state.meta?.eventCancelled)throw Error('tournament-started');
   if(room.updatedAt!==expectedUpdatedAt)throw Error('version-conflict');
   const ticket=(await tx.get(db.doc('commerceTickets/'+room.ticketAccessV1.ticketId))).data();
   if(ticket?.ownerUid!==authority.ownerUid||ticket.status!=='reserved'||ticket.boundRoomCode!==code||ticket.boundRoomId!==roomId)throw Error('ticket-binding-invalid');
   if(!Array.isArray(state.matches)||!Array.isArray(mirror.matches)||signature(state)!==signature(mirror)||
      state.matches.some(m=>m.startedAt||m.scoreA||m.scoreB||m.log?.length||m.completed&&!m.isBye||['in_progress','paused'].includes(m.status)))throw Error('bracket-version-conflict');
   const previousStations=state.meta.stations;
   if(state.meta.stations!==stations){
    state.meta.stations=stations;mirror.meta.stations=stations;
    let index=0;
    for(const match of [...state.matches].sort((a,b)=>a.seq-b.seq)){
     if(match.isBye){match.station=null;continue;}
     match.station=index++%stations+1;
     if(match.status==='ready')match.status='pending';
    }
    state.courtAssignments={};
    createEngine(state,{uid},now,operationId).rebuildCourtAssignments();
    const matches=new Map(state.matches.map(m=>[m.id,m]));
    mirror.matches=mirror.matches.map(m=>({...m,station:matches.get(m.id).station,status:matches.get(m.id).status}));
    mirror.courtAssignments=Object.fromEntries(Object.entries(state.courtAssignments).map(([key,court])=>[key,{currentMatchId:court.currentMatchId||null,nextMatchId:court.nextMatchId||null,status:court.status||'idle'}]));
   }
   const seats=R.reconcileSeatCount(room.refereeSeatsV1,stations,now,previousStations);
   const projection=seats.model?.version===1?R.projectSeats(seats.model,authority.ownerUid,stations):null;
   if(projection){
    Object.assign(state.meta,projection,{refereeSeatsV1:seats.model});
    Object.assign(mirror.meta,{refereeStationNames:projection.refereeStationNames,refereeSeatNames:projection.refereeSeatNames,refereeStationRestrictionEnabled:true});
    delete mirror.meta.refereeSeatsV1;delete mirror.meta.refereeStationUids;delete mirror.meta.refereeStationAssignments;delete mirror.meta.assignedStaffUids;
   }
   const revision=Math.max(now,room.updatedAt+1);
   tx.update(roomRef,{...(projection||{}),...(seats.changed?{refereeSeatsV1:seats.model}:{}),updatedAt:revision,data:JSON.stringify({...state,updatedAt:revision})});
   tx.update(publicRef,{updatedAt:revision,bracketView:JSON.stringify({...mirror,updatedAt:revision})});
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
   const gate=await resolveTicketGate(db,code,tx,gateSnap.data());
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
   const room=roomSnap.data(),gate=await resolveTicketGate(db,code,tx,gateSnap.data());
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
module.exports={createTicketRoomHandler,createPtnStatusHandler,createTicketRoomStateHandler,createTicketScheduleHandler,createTicketStationsHandler,createTicketRemoveHandler,createTicketDelegateHandler,createTicketDelegateSearchHandler};
