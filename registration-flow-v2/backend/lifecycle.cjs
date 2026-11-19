'use strict';

const {createHash,randomBytes}=require('node:crypto');
const {signature}=require('../../modules/main-app/bracket-commit.js');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const {advance:advanceQrCheckinFence}=require('../../qr-checkin/backend/qr-checkin-fence.cjs');
const {startMs}=require('../../qr-checkin/backend/overlays/lifecycle/operations-core.js');
const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');
const {ticketHostGrant,checkTicketContract}=require('./ticket-host.cjs');

const digest=value=>createHash('sha256').update(value).digest('hex');
const commonFields=['code','roomId','rosterRevision','operationId'];
const drawFields=new Set([...commonFields,'baseDrawId']);
const startFields=new Set([...commonFields,'drawId','confirmEarlyStart']);
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128;

function currentEligiblePlayers(state,registrations,confirmedCount){
 const players=state.players;
 const online=players.filter(player=>player.source==='online').map(player=>player.registrationId);
 const confirmed=new Set(registrations.docs.map(doc=>doc.id));
 if(confirmed.size!==confirmedCount||online.length!==confirmed.size||new Set(online).size!==online.length||
    online.some(id=>!confirmed.has(id)))throw Error('registration-roster-stale');
 const eligible=players.filter(player=>!state.meta.checkinRequired||player.checkedIn===true).map(player=>player.id);
 if(eligible.length<2||eligible.length>320||new Set(eligible).size!==eligible.length||
    eligible.some(id=>typeof id!=='string'||!id))throw Error('bracket-roster-changed');
 return eligible;
}

function ownsTicketRoom(room,grant,uid){
 return grant&&room?.createdByRole==='partner_organizer'&&room.createdBy===uid&&room.ownerUid===uid
  &&room.partnerOrganizationCode===grant.organizationId&&(room.partnerContractOrderCode||null)===grant.order;
}

async function readReservedTicket({db,tx,room,pub,state,roomId,code,uid,grant,now}){
 const access=room.ticketAccessV1;
 if(!access||access.version!==1||access.ownerUid!==uid||access.roomId!==roomId||
    typeof access.ticketId!=='string'||!/^BXH-SO-[A-Z0-9]{24}$/.test(access.ticketId)||
    pub.ticketRoomVersion!==1||state.meta?.eventAuthority!=='ticket'||
    [room.ladderMode,pub.ladderMode,state.meta?.ladderMode].some(mode=>mode!=='ranked'))throw Error('ticket-binding-invalid');
 const ref=db.doc('commerceTickets/'+access.ticketId);
 const settings=db.doc('systemSettings/commerceTicketLifecycleV1');
 const [ticketSnap,releaseSnap]=await tx.getAll(ref,settings);
 const release=releaseSnap.data(),ticket=ticketSnap.data();
 if(release?.enabled!==true||release.roomCode!==code||release.roomId!==roomId)throw Error('ticket-lifecycle-disabled');
 if(ticket?.version!==1||ticket.id!==access.ticketId||ticket.orderId!==access.ticketId||ticket.status!=='reserved'||
    ticket.ownerUid!==uid||ticket.boundRoomCode!==code||ticket.boundRoomId!==roomId||ticket.usedAt||
    (ticket.contractCode||null)!==(room.partnerContractOrderCode||null))throw Error('ticket-binding-invalid');
 if(!Number.isSafeInteger(ticket.expiresAt)||ticket.expiresAt<=now)throw Error('ticket-expired');
 const capacity=ticket.capacity;
 if(![32,64,96,128,160].includes(capacity)||access.baseCapacity!==capacity||
    access.addedCapacity!==0||ticket.addedCapacity!==0||room.capacity!==capacity||pub.capacity!==capacity||
    state.meta.registrationCapacity!==capacity||state.players.length>capacity)throw Error('ticket-capacity-invalid');
 if(ticket.contractCode){
  const contract=(await tx.get(db.doc('partnerContracts/'+ticket.contractCode))).data();
  checkTicketContract(contract,grant,uid);
 }
 return ref;
}

function createLifecycleHandler(action,{db,enabled=async()=>false,clock=Date.now}){
 const draw=action==='draw';
 const allowedFields=draw?drawFields:startFields;
 return async request=>{
  const uid=request.auth?.uid,input=request.data||{};
  if(!uid)throw Error('auth-required');
  const {code,roomId,baseDrawId,drawId,rosterRevision,operationId,confirmEarlyStart=false}=input;
  const expectedDrawId=draw?baseDrawId:drawId;
  if(Object.keys(input).some(key=>!allowedFields.has(key))||typeof code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(code)||
     !validId(roomId)||!(draw&&expectedDrawId===null||validId(expectedDrawId))||
     !Number.isSafeInteger(rosterRevision)||rosterRevision<0||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId)||
     typeof confirmEarlyStart!=='boolean')throw Error('invalid-operation');
  const roomRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const operationKey=digest(JSON.stringify([uid,operationId]));
  const operation=roomRef.collection('operationLog').doc('registration-v2-'+action+'-'+operationKey);
  const requestHash=digest(JSON.stringify([roomId,expectedDrawId,rosterRevision,confirmEarlyStart]));
  const now=clock(),drawSeed=draw?randomBytes(32).toString('hex'):null;
  return db.runTransaction(async tx=>{
   const [userSnap,roomSnap,publicSnap,prior]=await tx.getAll(db.doc('users/'+uid),roomRef,publicRef,operation);
   const user=userSnap.data();
   const room=roomSnap.data(),pub=publicSnap.data();
   const ticketRoom=room?.eventAuthority==='ticket'||pub?.eventAuthority==='ticket'||!!room?.ticketAccessV1||!!pub?.ticketRoomVersion;
   const grant=ticketRoom?ticketHostGrant(user,now):null;
   if(user?.active!==true||user.deleted||user.isTestAccount||['deleted','disabled','frozen'].includes(user.accountStatus)||
      (ticketRoom?!ownsTicketRoom(room,grant,uid):!['admin','super_admin'].includes(user.role)))throw Error('permission-denied');
   if(!room||!pub)throw Error('not-found');
   const state=JSON.parse(room.data),mirror=JSON.parse(pub.bracketView);
   if(state.id!==roomId)throw Error('bracket-room-changed');
   if(prior.exists){
    if(prior.data().requestHash!==requestHash||
       (ticketRoom&&prior.data().ticketId!==room.ticketAccessV1?.ticketId))throw Error('operation-conflict');
    return {...prior.data().result,replayed:true};
   }
   if(!registrationQueueOwnsRoom(room)||!await enabled(code,tx))throw Error('registration-queue-disabled');
   if(room.tournamentPhase!=='waiting'||pub.tournamentPhase!=='waiting'||room.startedAt||state.startedAt||mirror.startedAt)throw Error('bracket-started');
   if([room,pub,state].some(doc=>doc.systemClosed||doc.eventCancelled||doc.testMode||doc.deletionStatus||
      ['completed','archived'].includes(doc.archiveStatus)||doc.registrationSelection||doc.onsiteWaitlistServerOwned||
      doc.onsiteWaitlistDrawEnabled||doc.onsiteWaitlistDraw?.enabled||'scoreStorage' in doc||'scoreBucketProjection' in doc||
      (!ticketRoom&&(doc.createdByRole==='partner_organizer'||doc.partnerOrganizationCode)))||state.meta?.eventCancelled||
      state.entrySelection?.mode==='registration'||
      room.eventAuthority!==(ticketRoom?'ticket':'official')||pub.eventAuthority!==room.eventAuthority||
      room.registrationEnabled!==true||pub.registrationEnabled!==true||
      [room.battleMode,pub.battleMode,state.meta?.battleMode].some(mode=>mode&&mode!=='individual')||
      [room.formatType,pub.formatType,state.meta?.formatType].some(format=>format&&format!=='single')||
      !Number.isInteger(state.meta?.stations)||state.meta.stations<1||state.meta.stations>12)throw Error(draw?'draw-mode-not-supported':'start-mode-not-supported');
   if(!draw){
    const startAt=startMs(room,state)||(room.startAt?.toMillis?.()??Number(room.startAt||0));
    if(startAt>now&&!confirmEarlyStart)throw Error('early-start-confirmation-required');
   }
   if((state.registrationRosterRevision??0)!==rosterRevision)throw Error('registration-roster-stale');
   if((state.bracketDraw?.id??null)!==expectedDrawId||!Array.isArray(state.matches)||!Array.isArray(mirror.matches)||
      !draw&&(!state.bracketSize||!state.matches.length)||
      new Set(state.matches.map(match=>match.id)).size!==state.matches.length||
      state.matches.some(match=>!match.id||match.log?.length||match.scoreA||match.scoreB||match.completed&&!match.isBye)||
      signature(state)!==signature(mirror))throw Error('bracket-version-conflict');
   if(room.qrCheckinManaged!==pub.qrCheckinManaged||room.qrCheckinRevision!==pub.qrCheckinRevision)throw Error('qr-checkin-state-stale');
   const [pending,registrations]=await Promise.all([
    tx.get(db.collection(`_registrationQueueV2/${code}/_registrationQueueJobsV2`).where('state','in',['queued','running','attention']).limit(1)),
    tx.get(roomRef.collection('registrations').where('status','==','confirmed').limit(321)),
   ]);
   if(!pending.empty)throw Error('registration-queue-pending');
   if(registrations.size>320||room.confirmedCount!==pub.confirmedCount)throw Error('registration-roster-stale');
   const eligible=currentEligiblePlayers(state,registrations,room.confirmedCount);
   const ticketRef=ticketRoom?await readReservedTicket({db,tx,room,pub,state,roomId,code,uid,grant,now}):null;
   const phaseFields=draw?{}:{tournamentPhase:'live',registrationStatus:'started'};
   const result=draw
    ? commitDraw({state,mirror,uid,now,id:'v2-'+digest(JSON.stringify([code,roomId,operationKey])),drawSeed})
    : commitStart({state,mirror,uid,now,operationId,drawId,eligible});
   state.updatedAt=Math.max(now,Number(state.updatedAt||0)+1);
   const fence=room.qrCheckinManaged===true?advanceQrCheckinFence(room,state):{};
   const fields={...fence,...phaseFields,updatedAt:state.updatedAt};
   tx.update(roomRef,{...fields,bracketSize:state.bracketSize,data:JSON.stringify(state)});
   tx.update(publicRef,{...fields,bracketView:JSON.stringify(mirror)});
   if(ticketRef&&!draw)tx.update(ticketRef,{status:'consumed',usedAt:now,updatedAt:now});
   tx.create(operation,{requestHash,result,actorUid:uid,...(ticketRef?{ticketId:ticketRef.id}:{})});
   return result;
  });
 };
}

function publicCourts(state){
 return Object.fromEntries(Object.entries(state.courtAssignments||{}).map(([key,court])=>
  [key,{currentMatchId:court.currentMatchId||null,nextMatchId:court.nextMatchId||null,status:court.status||'idle'}]));
}

function commitDraw({state,mirror,uid,now,id,drawSeed}){
 const engine=createEngine(state,{uid},now,id,drawSeed);
 const revision=Number(state.bracketDraw?.revision||0)+1;
 if(!Number.isSafeInteger(revision)||revision<1)throw Error('bracket-version-conflict');
 if(!engine.generateSingleElim())throw Error('bracket-roster-changed');
 engine.rebuildCourtAssignments();
 state.bracketDraw={id,revision,at:now,actorUid:uid,...(state.meta?.eventAuthority==='ticket'?{rosterRevision:state.registrationRosterRevision??0}:{})};
 state.bracketDrawHistory=[...(state.bracketDrawHistory||[]),state.bracketDraw].slice(-20);
 Object.assign(mirror,{bracketSize:state.bracketSize,drawnAt:now,championId:null,runnerUpId:null,thirdId:null,fourthId:null});
 mirror.matches=state.matches.map(match=>({
  id:match.id,seq:match.seq,bracket:match.bracket,round:match.round,indexInRound:match.indexInRound,
  station:match.station,teamIds:null,a:match.a?{playerId:match.a.playerId}:null,b:match.b?{playerId:match.b.playerId}:null,
  isBye:match.isBye,scoreA:0,scoreB:0,log:[],winnerId:match.winnerId,loserId:match.loserId,
  completed:match.completed,completedAt:match.completedAt||null,status:match.status,
 }));
 mirror.courtAssignments=publicCourts(state);
 return {ok:true,drawId:id,drawnAt:now,revision};
}

function commitStart({state,mirror,uid,now,operationId,drawId,eligible}){
 const paired=new Set(state.matches.flatMap(match=>[match.a?.playerId,match.b?.playerId,match.winnerId]).filter(Boolean));
 if(eligible.length!==paired.size||eligible.some(id=>!paired.has(id)))throw Error('bracket-roster-changed');
 Object.assign(state,{startedAt:now,rosterLocked:true});
 state.meta.registrationStatus='started';
 if(state.meta.checkinRequired&&!state.meta.checkinClosedEarly){state.meta.checkinClosedEarly=true;state.meta.checkinClosedAt=now;}
 createEngine(state,{uid},now,operationId).rebuildCourtAssignments();
 const matches=new Map(state.matches.map(match=>[match.id,match]));
 mirror.matches=mirror.matches.map(match=>({...match,status:matches.get(match.id).status,station:matches.get(match.id).station}));
 mirror.courtAssignments=publicCourts(state);
 mirror.startedAt=now;
 return {ok:true,startedAt:now,drawId};
}

const createStartHandler=options=>createLifecycleHandler('start',options);
const createDrawHandler=options=>createLifecycleHandler('draw',options);
module.exports={createStartHandler,createDrawHandler};
