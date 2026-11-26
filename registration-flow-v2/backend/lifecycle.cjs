'use strict';

const {createHash,randomBytes}=require('node:crypto');
const {signature}=require('../../modules/main-app/bracket-commit.js');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const Fault=require('../../referee-seats/functions/engine/fault.cjs');
const {applyStandardControl}=require('../../referee-seats/functions/scoring-core.cjs');
const PassReturn=require('../../referee-seats/functions/engine/pass-return.cjs').BXHPassReturn;
const {protectedPass}=require('../../referee-seats/functions/dispatch-core.cjs');
const {BXHCourtRetirement:R}=require('../../referee-seats/functions/engine/court-retirement.cjs');
const {advance:advanceQrCheckinFence}=require('../../qr-checkin/backend/qr-checkin-fence.cjs');
const {startMs}=require('../../qr-checkin/backend/overlays/lifecycle/operations-core.js');
const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');
const {resolveTicketRefereeAuthority,ticketSeatReleaseEnabled}=require('./ticket-referee-seat.cjs');
const {checkTicketContract,isPartnerRoomCode,validRegistrationRoomCode,ticketLifecyclePath,resolveTicketGate,authorizeTicketManager}=require('./ticket-host.cjs');

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

async function readReservedTicket({db,tx,room,pub,state,roomId,code,uid,grant,now}){
 const access=room.ticketAccessV1;
 if(!access||access.version!==1||access.ownerUid!==uid||access.roomId!==roomId||
    typeof access.ticketId!=='string'||!/^BXH-SO-[A-Z0-9]{24}$/.test(access.ticketId)||
    pub.ticketRoomVersion!==1||state.meta?.eventAuthority!=='ticket'||
    [room.ladderMode,pub.ladderMode,state.meta?.ladderMode].some(mode=>mode!=='ranked'))throw Error('ticket-binding-invalid');
 const ref=db.doc('commerceTickets/'+access.ticketId);
 const settings=db.doc(ticketLifecyclePath(code));
 const [ticketSnap,releaseSnap]=await tx.getAll(ref,settings);
 const release=await resolveTicketGate(db,code,tx,releaseSnap.data()),ticket=ticketSnap.data();
 if(release?.enabled!==true||release.roomCode!==code||release.roomId!==roomId||release.ownerUid!==uid)throw Error('ticket-lifecycle-disabled');
 if(![1,2].includes(ticket?.version)||
    (room.ptnSettlementVersion===1)!==(ticket.version===2)||
    ticket.id!==access.ticketId||ticket.orderId!==access.ticketId||ticket.status!=='reserved'||
    ticket.ownerUid!==uid||ticket.boundRoomCode!==code||ticket.boundRoomId!==roomId||ticket.usedAt||
    (ticket.contractCode||null)!==(room.partnerContractOrderCode||null))throw Error('ticket-binding-invalid');
 if(ticket.version===1&&(!Number.isSafeInteger(ticket.expiresAt)||ticket.expiresAt<=now)||
    ticket.version===2&&ticket.expiresAt!==null)throw Error('ticket-expired');
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
  if(Object.keys(input).some(key=>!allowedFields.has(key))||!validRegistrationRoomCode(code)||
     !validId(roomId)||!(draw&&expectedDrawId===null||validId(expectedDrawId))||
     !Number.isSafeInteger(rosterRevision)||rosterRevision<0||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId)||
     typeof confirmEarlyStart!=='boolean')throw Error('invalid-operation');
  const roomRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const operationKey=digest(JSON.stringify([uid,operationId]));
  const operation=roomRef.collection('operationLog').doc('registration-v2-'+action+'-'+operationKey);
  const requestHash=digest(JSON.stringify([roomId,expectedDrawId,rosterRevision,confirmEarlyStart]));
  const now=clock(),drawSeed=draw?randomBytes(32).toString('hex'):null;
  return db.runTransaction(async tx=>{
   const [userSnap,roomSnap,publicSnap,prior,gateSnap]=await tx.getAll(db.doc('users/'+uid),roomRef,publicRef,operation,db.doc(ticketLifecyclePath(code)));
   const user=userSnap.data();
   const room=roomSnap.data(),pub=publicSnap.data();
   const ticketRoom=room?.eventAuthority==='ticket'||pub?.eventAuthority==='ticket'||!!room?.ticketAccessV1||!!pub?.ticketRoomVersion;
   const gate=ticketRoom?await resolveTicketGate(db,code,tx,gateSnap.data()):null;
   const authority=ticketRoom?await authorizeTicketManager(tx,db,{uid,user,room,gate,code,now}):null;
   const grant=authority?.grant;
   if(user?.active!==true||user.deleted||user.isTestAccount||['deleted','disabled','frozen'].includes(user.accountStatus)||
      (!ticketRoom&&!['admin','super_admin'].includes(user.role))){
    const error=Error('permission-denied');
    if(ticketRoom)error.ptnPermissionStage='actor-inactive';
    throw error;
   }
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
   const ticketRef=ticketRoom?await readReservedTicket({db,tx,room,pub,state,roomId,code,uid:authority.ownerUid,grant,now}):null;
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

const forfeitFields=new Set(['action','code','roomId','matchId','playerId','opponentId','matchUpdatedAt','operationId']);

function forfeitMatchAvailable(match){
 return !!(match?.a?.playerId&&match?.b?.playerId&&match.a.playerId!==match.b.playerId&&
  !match.isBye&&!match.completed&&!match.winnerId&&['pending','ready','in_progress','paused'].includes(match.status)&&
  !match.callPass&&!match.skippedAt);
}

// Keep legacy scoring untouched; once a retirement command exists, detached or
// closed-court work must be claimed/reopened before another score can be written.
function ticketCanSkip(state,match){return !!match&&!match.skippedAt&&!protectedPass(state,match)&&PassReturn.supported(state)&&PassReturn.predecessors(state,match).length>0;}
function ticketCourtSummary(state,station){
 const names=new Map((state.players||[]).map(p=>[p.id,p.name]));
 const id=state.courtAssignments?.['court'+station]?.nextMatchId;
 const next=(state.matches||[]).find(m=>m.id===id&&!m.completed&&!m.isBye&&m.a?.playerId&&m.b?.playerId);
 return {completedCount:(state.matches||[]).filter(m=>Number(m.station)===station&&m.completed&&!m.isBye).length,
  nextMatch:next?{id:next.id,seq:next.seq,round:next.round,a:{name:names.get(next.a.playerId)||'選手 A'},b:{name:names.get(next.b.playerId)||'選手 B'}}:null};
}
function ticketMatchCourtAvailable(state,match){
 if(!state.courtRetirementPlan&&!state.forcedCourtExits)return true;
 return !match?.forceDetached&&Number(match?.station)>0&&Number(match.station)<=Number(state.meta?.stations)&&!state.forcedCourtExits?.[match.station]?.closed;
}

// Shared transaction projection for live retirement and subsequent score/forfeit
// confirmations that can finish a draining court. Never copy private seat UIDs.
function projectTicketCourtState(room,state,mirror,ownerUid,previousStations,now,forceRouting=false){
 if(!forceRouting&&!state.courtRetirementPlan&&!state.forcedCourtExits)return {};
 mirror.meta.stations=state.meta.stations;
 mirror.courtAssignments=publicCourts(state);
 const matches=new Map(state.matches.map(m=>[m.id,m]));
 mirror.matches=mirror.matches.map(m=>{const source=matches.get(m.id);return {...m,station:source.station??null,status:source.status,dispatchRevision:Number(source.dispatchRevision||0),forceDetached:source.forceDetached||null,skippedAt:source.skippedAt||null,skipWaitFor:source.skipWaitFor||[],resumeQueuedAt:source.resumeQueuedAt||null,passReturn:source.passReturn||null};});
 mirror.courtRetirementPlan=state.courtRetirementPlan||null;
 mirror.forcedCourtExits=state.forcedCourtExits||{};
 const seats=R.reconcileSeatCount(room.refereeSeatsV1,state.meta.stations,now,previousStations);
 if(seats.model?.version!==1)return {};
 const projection=R.projectSeats(seats.model,ownerUid,state.meta.stations);
 Object.assign(state.meta,projection,{refereeSeatsV1:seats.model});
 Object.assign(mirror.meta,{refereeStationNames:projection.refereeStationNames,refereeSeatNames:projection.refereeSeatNames,refereeStationRestrictionEnabled:true});
 for(const key of ['refereeSeatsV1','refereeStationUids','refereeStationAssignments','assignedStaffUids'])delete mirror.meta[key];
 return {...projection,...(seats.changed?{refereeSeatsV1:seats.model}:{})};
}

// Keep PTN scoring eligibility independent of the referee engine's exported
// helper list. The closed roster callable can carry an older engine archive.
function ticketRoundBlocked(match,matches,meta){
 if((meta?.formatType||'single')!=='single'||!match||match.bracket!=='SE')return false;
 return matches.some(m=>m&&m.bracket==='SE'&&!m.isBye&&!m.completed&&
  Number(m.round||0)<Number(match.round||0)&&
  (m.status!=='in_progress'||!!m.skippedAt||!!m.callPass));
}

function ticketBronzeBlocked(match,matches,meta){
 if(!match||match.bracket!=='SE'||(meta?.formatType||'single')!=='single'||!meta?.bronzeMatch)return false;
 const se=matches.filter(m=>m&&m.bracket==='SE'&&!m.isBye);
 if(!se.length)return false;
 const finalRound=Math.max(...se.map(m=>Number(m.round)||0));
 if(finalRound<1||Number(match.round||0)!==finalRound)return false;
 const semis=se.filter(m=>Number(m.round||0)===finalRound-1);
 if(semis.length!==2||!semis.every(m=>m.completed&&m.loserId))return false;
 const bronze=matches.find(m=>m&&m.bracket==='BZ'&&!m.isBye);
 return !bronze?.completed;
}

function createTicketForfeitHandler({db,enabled=async()=>false,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,input=request.data||{};
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const {action,code,roomId,matchId,playerId,opponentId,matchUpdatedAt,operationId}=input;
  if(action!=='ticket-room-forfeit'||Object.keys(input).some(key=>!forfeitFields.has(key))||
     !validRegistrationRoomCode(code)||
     ![roomId,matchId,playerId,opponentId].every(validId)||playerId===opponentId||
     !Number.isSafeInteger(matchUpdatedAt)||matchUpdatedAt<0||
     typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId))throw Error('invalid-operation');
  const roomRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const operation=roomRef.collection('operationLog').doc('registration-v2-forfeit-'+digest(JSON.stringify([uid,operationId])));
  const requestHash=digest(JSON.stringify([roomId,matchId,playerId,opponentId,matchUpdatedAt]));
  const now=clock();
  return db.runTransaction(async tx=>{
   const [actor,roomSnap,publicSnap,gateSnap,prior]=await tx.getAll(db.doc('users/'+uid),roomRef,publicRef,
    db.doc(ticketLifecyclePath(code)),operation);
   const user=actor.data(),room=roomSnap.data(),pub=publicSnap.data(),gate=await resolveTicketGate(db,code,tx,gateSnap.data());
   const authority=await authorizeTicketManager(tx,db,{uid,user,room,gate,code,now});
   if(gate.roomId!==roomId||room.ticketAccessV1?.roomId!==roomId||
      pub?.ticketRoomVersion!==1||pub.eventAuthority!=='ticket')throw Error('ticket-binding-invalid');
   const state=JSON.parse(room.data),mirror=JSON.parse(pub.bracketView);
   if(state.id!==roomId)throw Error('bracket-room-changed');
   if(prior.exists){
    if(prior.data().requestHash!==requestHash)throw Error('operation-conflict');
    return {...prior.data().result,replayed:true};
   }
   if(gate.enabled!==true||!registrationQueueOwnsRoom(room)||!await enabled(code,tx))throw Error('ticket-lifecycle-disabled');
   if(room.tournamentPhase!=='live'||pub.tournamentPhase!=='live'||!state.startedAt||!state.rosterLocked||
      state.championId||[room,pub,state].some(doc=>doc.systemClosed||doc.eventCancelled||doc.deletionStatus||
       ['completed','archived'].includes(doc.archiveStatus)||'scoreStorage' in doc||'scoreBucketProjection' in doc)||
      state.meta?.eventCancelled||state.meta?.eventAuthority!=='ticket'||state.meta?.formatType!=='single')throw Error('forfeit-room-not-live');
   const match=state.matches.find(candidate=>candidate.id===matchId);
   const publicMatch=mirror.matches.find(candidate=>candidate.id===matchId);
   const playerIds=[match?.a?.playerId,match?.b?.playerId];
   if(!forfeitMatchAvailable(match)||!ticketMatchCourtAvailable(state,match)||!playerIds.includes(playerId)||!playerIds.includes(opponentId)||
      (match.updatedAt||0)!==matchUpdatedAt||publicMatch?.completed||publicMatch?.a?.playerId!==playerIds[0]||
      publicMatch?.b?.playerId!==playerIds[1])throw Error('forfeit-match-stale');
   const actorName=String(user.realName||user.gameId||user.displayName||'合作主辦').slice(0,80);
   const engine=createEngine(state,{uid,name:actorName},now,operationId);
   if(ticketRoundBlocked(match,state.matches,state.meta)||
      ticketBronzeBlocked(match,state.matches,state.meta))throw Error('forfeit-round-waiting');
   const decision=engine.evaluateQuickDecision(match,opponentId);
   if(!decision.ok)throw Error('forfeit-match-stale');
   const partialScore={scoreA:match.scoreA??null,scoreB:match.scoreB??null,log:match.log||[],faultActions:match.faultActions||[]};
   engine.applyQuickDecisionFields(match,decision,actorName);
   match.resultMethod='forfeit';
   match.forfeit=true;
   match.hunterData={...match.hunterData,reason:'forfeit'};
   match.faultActions=[];
   match.refereeSeatScoreRevision=Number(match.refereeSeatScoreRevision||0)+1;
   const previousStations=state.meta.stations;
   engine.rebuildPropagationForState(state);
   const updatedAt=Math.max(now,Number(room.updatedAt||0)+1,Number(state.updatedAt||0)+1);
   state.updatedAt=updatedAt;
   const priorMatches=new Map(mirror.matches.map(item=>[item.id,item]));
   mirror.matches=state.matches.map(item=>({...priorMatches.get(item.id),
    a:item.a?.playerId?{playerId:item.a.playerId}:null,b:item.b?.playerId?{playerId:item.b.playerId}:null,
    station:item.station??null,status:item.status,isBye:!!item.isBye,completed:!!item.completed,
    scoreA:item.scoreA??null,scoreB:item.scoreB??null,log:item.log||[],faultActions:Fault.snapshot(item),
    skippedAt:item.skippedAt||null,skipWaitFor:item.skipWaitFor||[],resumeQueuedAt:item.resumeQueuedAt||null,passReturn:item.passReturn||null,
    winnerId:item.winnerId||null,loserId:item.loserId||null,completedAt:item.completedAt||null,
    confirmedAt:item.confirmedAt||null,resultMethod:item.resultMethod||null,forfeit:item.forfeit===true}));
   Object.assign(mirror,{updatedAt,courtAssignments:publicCourts(state),callRevision:Number(state.callRevision||0)});
   for(const key of ['championId','runnerUpId','thirdId','fourthId'])mirror[key]=state[key]??null;
   const fence=room.qrCheckinManaged===true?advanceQrCheckinFence(room,state):{};
   const courtFields=projectTicketCourtState(room,state,mirror,authority.ownerUid,previousStations,now);
   tx.update(roomRef,{...fence,...courtFields,updatedAt,data:JSON.stringify(state)});
   tx.update(publicRef,{...fence,updatedAt,bracketView:JSON.stringify(mirror)});
   const result={ok:true,matchId,winnerId:decision.winnerId,loserId:decision.loserId};
   tx.create(operation,{requestHash,result,actorUid:uid,at:now,partialScore});
   return result;
  });
 };
}

const ticketScoreFields=new Set(['action','code','roomId','matchId','matchUpdatedAt','operationId','command','side','finish','station','expectedCourtRevision']);
const standardControls=new Set(['fault','rematch','pause','resume','skip']);
const ticketPoints=Object.freeze({spin:1,knockout:2,burst:2,extreme:3});
function createTicketScoreHandler({db,enabled=async()=>false,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,input=request.data||{};
  if(!uid)throw Error('auth-required');
  if(!request.app)throw Error('permission-denied');
  const {action,code,roomId,matchId,matchUpdatedAt,operationId,command,side,finish,station,expectedCourtRevision}=input;
  const scoped=station!==undefined||expectedCourtRevision!==undefined;
  if(action!=='ticket-room-score'||Object.keys(input).some(key=>!ticketScoreFields.has(key))||
     !isPartnerRoomCode(code)||![roomId,matchId].every(validId)||
     !Number.isSafeInteger(matchUpdatedAt)||matchUpdatedAt<0||
     (scoped&&(!Number.isInteger(station)||station<1||station>12||!Number.isSafeInteger(expectedCourtRevision)||expectedCourtRevision<0))||
     typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId)||
     !['score','undo','confirm',...standardControls].includes(command)||
     (command==='score'?(!['A','B'].includes(side)||!Object.hasOwn(ticketPoints,finish)):command==='fault'?(!['A','B'].includes(side)||finish!==undefined):(side!==undefined||finish!==undefined)))throw Error('invalid-operation');
  const roomRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const operation=roomRef.collection('operationLog').doc('ticket-room-score-'+digest(JSON.stringify([uid,operationId])));
  const requestHash=digest(JSON.stringify([roomId,matchId,matchUpdatedAt,command,side,finish,...(scoped?[station,expectedCourtRevision]:[])]));
  const now=clock();
  return db.runTransaction(async tx=>{
   const [actor,roomSnap,publicSnap,gateSnap,prior]=await tx.getAll(db.doc('users/'+uid),roomRef,publicRef,
    db.doc(ticketLifecyclePath(code)),operation);
   const user=actor.data(),room=roomSnap.data(),pub=publicSnap.data(),gate=await resolveTicketGate(db,code,tx,gateSnap.data());
   let authority;
   if(!scoped)authority=await authorizeTicketManager(tx,db,{uid,user,room,gate,code,now});
   if(!room||!pub||!gate)throw Error('ticket-binding-invalid');
   const state=JSON.parse(room.data),mirror=JSON.parse(pub.bracketView);
   if(scoped){
    if(!ticketSeatReleaseEnabled((await tx.get(db.doc('systemConfig/refereeSeatsV1'))).data()))throw Error('ticket-invite-unavailable');
    authority=await resolveTicketRefereeAuthority({db,enabled,tx,room,publicRoom:pub,state,user,code,now});
    const court=room.refereeSeatsV1?.version===1&&room.refereeSeatsV1.courts?.[station];
    if(!court||station>state.meta.stations||court.retired||state.forcedCourtExits?.[station]?.closed||court.main?.uid!==uid)throw Error('permission-denied');
    if(court.revision!==expectedCourtRevision)throw Error('seat-stale');
   }
   if(gate.roomId!==roomId||room.ticketAccessV1?.roomId!==roomId||
      pub?.ticketRoomVersion!==1||pub.eventAuthority!=='ticket')throw Error('ticket-binding-invalid');
   if(state.id!==roomId||mirror.id!==roomId)throw Error('bracket-room-changed');
   if(prior.exists){
    if(prior.data().requestHash!==requestHash)throw Error('operation-conflict');
    return {...prior.data().result,replayed:true};
   }
   if(gate.enabled!==true||!registrationQueueOwnsRoom(room)||!await enabled(code,tx))throw Error('ticket-lifecycle-disabled');
   const ticket=(await tx.get(db.doc('commerceTickets/'+room.ticketAccessV1.ticketId))).data();
   if(ticket?.status!=='consumed'||ticket.ownerUid!==authority.ownerUid||
      ticket.boundRoomCode!==code||ticket.boundRoomId!==roomId)throw Error('ticket-binding-invalid');
   if(room.tournamentPhase!=='live'||pub.tournamentPhase!=='live'||!state.startedAt||!state.rosterLocked||
      state.championId||[room,pub,state].some(doc=>doc.systemClosed||doc.eventCancelled||doc.deletionStatus||
       ['completed','archived'].includes(doc.archiveStatus)||'scoreStorage' in doc||'scoreBucketProjection' in doc)||
      state.meta?.eventCancelled||state.meta?.eventAuthority!=='ticket'||state.meta?.formatType!=='single'||
      state.meta?.battleMode!=='individual'||!Array.isArray(state.matches)||!Array.isArray(mirror.matches))throw Error('score-room-not-live');
   const match=state.matches.find(item=>item.id===matchId);
   const publicMatch=mirror.matches.find(item=>item.id===matchId);
   if(scoped&&(state.courtAssignments?.['court'+station]?.currentMatchId!==matchId||Number(match?.station)!==station))throw Error('score-match-stale');
   if(standardControls.has(command)&&state.courtAssignments?.['court'+match?.station]?.currentMatchId!==matchId)throw Error('score-match-stale');
   if(!forfeitMatchAvailable(match)||!ticketMatchCourtAvailable(state,match)||(match.updatedAt||0)!==matchUpdatedAt||
      publicMatch?.completed||publicMatch?.a?.playerId!==match.a.playerId||
      publicMatch?.b?.playerId!==match.b.playerId||
      Number(publicMatch.scoreA||0)!==Number(match.scoreA||0)||
      Number(publicMatch.scoreB||0)!==Number(match.scoreB||0)||
      !['standard',undefined,null].includes(match.scoringMode)||
      !['standard',undefined,null].includes(state.meta.scoringMode))throw Error('score-match-stale');
   const actorName=String(user.realName||user.gameId||user.displayName||'合作主辦').slice(0,80);
   const engine=createEngine(state,{uid,name:actorName},now,operationId);
   if(ticketRoundBlocked(match,state.matches,state.meta)||
      ticketBronzeBlocked(match,state.matches,state.meta))throw Error('score-round-waiting');
   match.scoringMode='standard';
   if(command==='score'){
    if(engine.checkWinnerSide(match))throw Error('score-match-stale');
    const key=side==='A'?'scoreA':'scoreB',points=ticketPoints[finish],current=Number(match[key]||0);
    if(!Number.isInteger(current)||current<0||current+points>6)throw Error('score-match-stale');
    const event=engine.createHunterRoundEvent(match,side,finish,points,now);
    Fault.attachSnapshotToEvent(match,event);
    match[key]=current+points;(match.log||(match.log=[])).push(event);Fault.clear(match);
    match.status='in_progress';match.startedAt=match.startedAt||now;
   }else if(command==='undo'){
    if(Fault.hasPending(match))Fault.popPending(match);
    else{
     const last=match.log?.at(-1);
     if(!last||!['A','B'].includes(last.side)||!Number.isInteger(last.points)||last.points<1||last.points>3||
        Number(match[last.side==='A'?'scoreA':'scoreB']||0)<last.points)throw Error('score-match-stale');
     match.log.pop();match[last.side==='A'?'scoreA':'scoreB']-=last.points;Fault.restoreFromEvent(match,last);
    }
   }else if(command==='skip'){
    if(!ticketCanSkip(state,match))throw Error('no-pass-alternative');
    engine.markMatchSkipped(match.id);
   }else if(standardControls.has(command)){
    if(command==='fault'&&engine.checkWinnerSide(match))throw Error('score-match-stale');
    applyStandardControl(match,command,side,now);
   }else{
    const decision=engine.evaluateMatchCompletion(match);
    if(!decision.ok)throw Error('score-result-not-ready');
    engine.applyMatchCompletionFields(match,decision,actorName);
   }
   match.updatedAt=Math.max(now,Number(match.updatedAt||0)+1);
   match.updatedBy=actorName;
   match.refereeSeatScoreRevision=Number(match.refereeSeatScoreRevision||0)+1;
   const previousStations=state.meta.stations;
   if(command==='confirm'||command==='skip')engine.rebuildPropagationForState(state);
   const updatedAt=Math.max(now,Number(room.updatedAt||0)+1,Number(state.updatedAt||0)+1);
   state.updatedAt=updatedAt;
   const priorMatches=new Map(mirror.matches.map(item=>[item.id,item]));
   mirror.matches=state.matches.map(item=>({...priorMatches.get(item.id),
    a:item.a?.playerId?{playerId:item.a.playerId}:null,b:item.b?.playerId?{playerId:item.b.playerId}:null,
    station:item.station??null,status:item.status,isBye:!!item.isBye,completed:!!item.completed,
    scoreA:item.scoreA??null,scoreB:item.scoreB??null,log:item.log||[],faultActions:Fault.snapshot(item),
    skippedAt:item.skippedAt||null,skipWaitFor:item.skipWaitFor||[],resumeQueuedAt:item.resumeQueuedAt||null,passReturn:item.passReturn||null,
    winnerId:item.winnerId||null,loserId:item.loserId||null,completedAt:item.completedAt||null,
    confirmedAt:item.confirmedAt||null,resultMethod:item.resultMethod||null,forfeit:item.forfeit===true}));
   Object.assign(mirror,{updatedAt,courtAssignments:publicCourts(state),callRevision:Number(state.callRevision||0)});
   for(const key of ['championId','runnerUpId','thirdId','fourthId'])mirror[key]=state[key]??null;
   const fence=room.qrCheckinManaged===true?advanceQrCheckinFence(room,state):{};
   const courtFields=projectTicketCourtState(room,state,mirror,authority.ownerUid,previousStations,now);
   tx.update(roomRef,{...fence,...courtFields,updatedAt,data:JSON.stringify(state)});
   tx.update(publicRef,{...fence,updatedAt,bracketView:JSON.stringify(mirror)});
   const result={ok:true,matchId,scoreA:Number(match.scoreA||0),scoreB:Number(match.scoreB||0),
    completed:!!match.completed,winnerId:match.winnerId||null,faultActions:Fault.snapshot(match),status:match.status};
   tx.create(operation,{requestHash,result,actorUid:uid,at:now});
   return result;
  });
 };
}

module.exports={createStartHandler,createDrawHandler,createTicketForfeitHandler,createTicketScoreHandler,
 forfeitMatchAvailable,ticketRoundBlocked,ticketBronzeBlocked,ticketMatchCourtAvailable,projectTicketCourtState,ticketCourtSummary,ticketCanSkip};
