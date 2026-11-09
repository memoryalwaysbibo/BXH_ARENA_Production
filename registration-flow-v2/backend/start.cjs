'use strict';

const {createHash}=require('node:crypto');
const {signature}=require('../../modules/main-app/bracket-commit.js');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const {advance:advanceQrCheckinFence}=require('../../qr-checkin/backend/qr-checkin-fence.cjs');
const {startMs}=require('../../qr-checkin/backend/overlays/lifecycle/operations-core.js');
const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');

const digest=value=>createHash('sha256').update(value).digest('hex');
const allowedFields=new Set(['code','roomId','drawId','rosterRevision','operationId','confirmEarlyStart']);

function checkRoster(state,registrations,confirmedCount){
 const players=state.players;
 const online=players.filter(player=>player.source==='online').map(player=>player.registrationId);
 const confirmed=new Set(registrations.docs.map(doc=>doc.id));
 if(confirmed.size!==confirmedCount||online.length!==confirmed.size||new Set(online).size!==online.length||
    online.some(id=>!confirmed.has(id)))throw Error('registration-roster-stale');
 const eligible=players.filter(player=>!state.meta.checkinRequired||player.checkedIn===true).map(player=>player.id);
 const paired=new Set(state.matches.flatMap(match=>[match.a?.playerId,match.b?.playerId,match.winnerId]).filter(Boolean));
 if(eligible.length<2||eligible.length!==paired.size||new Set(eligible).size!==eligible.length||
    eligible.some(id=>!id||!paired.has(id)))throw Error('bracket-roster-changed');
}

function createStartHandler({db,enabled=async()=>false,clock=Date.now}){
 return async request=>{
  const uid=request.auth?.uid,input=request.data||{};
  if(!uid)throw Error('auth-required');
  const {code,roomId,drawId,rosterRevision,operationId,confirmEarlyStart=false}=input;
  if(Object.keys(input).some(key=>!allowedFields.has(key))||typeof code!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(code)||
     typeof roomId!=='string'||!roomId||roomId.length>128||typeof drawId!=='string'||!drawId||drawId.length>128||
     !Number.isSafeInteger(rosterRevision)||rosterRevision<0||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId)||
     typeof confirmEarlyStart!=='boolean')throw Error('invalid-operation');
  const roomRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const operation=roomRef.collection('operationLog').doc('registration-v2-start-'+digest(JSON.stringify([uid,operationId])));
  const requestHash=digest(JSON.stringify([roomId,drawId,rosterRevision,confirmEarlyStart]));
  const now=clock();
  return db.runTransaction(async tx=>{
   const [userSnap,roomSnap,publicSnap,prior]=await tx.getAll(db.doc('users/'+uid),roomRef,publicRef,operation);
   const user=userSnap.data();
   if(user?.active!==true||user.deleted||user.isTestAccount||['deleted','disabled','frozen'].includes(user.accountStatus)||
      !['admin','super_admin'].includes(user.role))throw Error('permission-denied');
   const room=roomSnap.data(),pub=publicSnap.data();
   if(!room||!pub)throw Error('not-found');
   const state=JSON.parse(room.data),mirror=JSON.parse(pub.bracketView);
   if(state.id!==roomId)throw Error('bracket-room-changed');
   if(prior.exists){
    if(prior.data().requestHash!==requestHash)throw Error('operation-conflict');
    return {...prior.data().result,replayed:true};
   }
   if(!registrationQueueOwnsRoom(room)||!await enabled(code,tx))throw Error('registration-queue-disabled');
   if(room.tournamentPhase!=='waiting'||pub.tournamentPhase!=='waiting'||state.startedAt||mirror.startedAt)throw Error('bracket-started');
   if([room,pub,state].some(doc=>doc.systemClosed||doc.eventCancelled||doc.testMode||doc.deletionStatus||
      ['completed','archived'].includes(doc.archiveStatus)||doc.registrationSelection||doc.onsiteWaitlistServerOwned||
      doc.onsiteWaitlistDrawEnabled||doc.onsiteWaitlistDraw?.enabled||'scoreStorage' in doc||'scoreBucketProjection' in doc||
      doc.createdByRole==='partner_organizer'||doc.partnerOrganizationCode)||state.meta?.eventCancelled||
      state.entrySelection?.mode==='registration'||room.eventAuthority!=='official'||pub.eventAuthority!=='official'||
      room.registrationEnabled!==true||pub.registrationEnabled!==true||
      [room.battleMode,pub.battleMode,state.meta?.battleMode].some(mode=>mode&&mode!=='individual')||
      [room.formatType,pub.formatType,state.meta?.formatType].some(format=>format&&format!=='single')||
      !Number.isInteger(state.meta?.stations)||state.meta.stations<1||state.meta.stations>12)throw Error('start-mode-not-supported');
   const startAt=startMs(room,state)||(room.startAt?.toMillis?.()??Number(room.startAt||0));
   if(startAt>now&&!confirmEarlyStart)throw Error('early-start-confirmation-required');
   if((state.registrationRosterRevision??0)!==rosterRevision)throw Error('registration-roster-stale');
   if(state.bracketDraw?.id!==drawId||!state.bracketSize||!state.matches?.length||
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
   checkRoster(state,registrations,room.confirmedCount);

   Object.assign(state,{startedAt:now,rosterLocked:true,updatedAt:Math.max(now,Number(state.updatedAt||0)+1)});
   state.meta.registrationStatus='started';
   if(state.meta.checkinRequired&&!state.meta.checkinClosedEarly){state.meta.checkinClosedEarly=true;state.meta.checkinClosedAt=now;}
   createEngine(state,{uid},now,operationId).rebuildCourtAssignments();
   const matches=new Map(state.matches.map(match=>[match.id,match]));
   mirror.matches=mirror.matches.map(match=>({...match,status:matches.get(match.id).status,station:matches.get(match.id).station}));
   mirror.courtAssignments=Object.fromEntries(Object.entries(state.courtAssignments||{}).map(([key,court])=>
    [key,{currentMatchId:court.currentMatchId||null,nextMatchId:court.nextMatchId||null,status:court.status||'idle'}]));
   mirror.startedAt=now;
   const fence=room.qrCheckinManaged===true?advanceQrCheckinFence(room,state):{};
   const fields={...fence,tournamentPhase:'live',registrationStatus:'started',updatedAt:state.updatedAt};
   const result={ok:true,startedAt:now,drawId};
   tx.update(roomRef,{...fields,data:JSON.stringify(state)});
   tx.update(publicRef,{...fields,bracketView:JSON.stringify(mirror)});
   tx.create(operation,{requestHash,result,actorUid:uid});
   return result;
  });
 };
}

module.exports={createStartHandler};
