'use strict';
// Server-only candidate for an atomic create of a new official individual room.
// Never expose this handler to the client without completing the createRoom adapter
// and full Firestore emulator + quota/security verification.
const {createHash}=require('node:crypto');
const {initialize}=require('./auto-init-core.cjs');
const CODE=/^BXH-[A-Z0-9]{4,16}$/;
const OP=/^[A-Za-z0-9_-]{16,100}$/;
function err(reason){throw new Error(reason);}
function parse(v){try{return JSON.parse(v);}catch{return null;}}
function createHandler(db,{clock=Date.now}={}){
 return async function create(request){
  const uid=request.auth?.uid,d=request.data||{};
  if(!uid)err('unauthenticated');
  const code=String(d.code||'').toUpperCase();
  if(!CODE.test(code)||!OP.test(d.operationId||''))err('invalid-request');
  if(!d.privatePayload||!d.publicPayload||typeof d.privatePayload!=='object'||typeof d.publicPayload!=='object')err('invalid-request');
  const hash=createHash('sha256').update(JSON.stringify({code,privatePayload:d.privatePayload,publicPayload:d.publicPayload})).digest('hex');
  const roomRef=db.doc('tournaments/'+code),pubRef=db.doc('publicTournaments/'+code);
  const receiptRef=db.doc('roomCreationOperations/'+createHash('sha256').update(uid+':'+d.operationId).digest('hex'));
  return db.runTransaction(async tx=>{
   const [userSnap,releaseSnap,roomSnap,pubSnap,receiptSnap]=await Promise.all([
    tx.get(db.doc('users/'+uid)),tx.get(db.doc('systemConfig/refereeSeatsV1')),
    tx.get(roomRef),tx.get(pubRef),tx.get(receiptRef)]);
   const user=userSnap.data();
   if(releaseSnap.data()?.autoCreateEnabled!==true)err('auto-create-not-enabled');
   if(user?.active!==true||user?.isTestAccount===true||user?.deleted===true||['deleted','frozen','disabled'].includes(user?.accountStatus)||!['staff','admin','super_admin'].includes(user.role))err('permission-denied');
   if(receiptSnap.exists){
    const receipt=receiptSnap.data();
    if(receipt.uid!==uid||receipt.hash!==hash||receipt.code!==code)err('operation-conflict');
    // Never report a successful retry when one or both room documents have
    // since been deleted. This would otherwise strand a user in a dead room.
    if(!roomSnap.exists||!pubSnap.exists)err('room-receipt-inconsistent');
    if(roomSnap.data()?.createdBy!==uid)err('room-receipt-inconsistent');
    return {ok:true,code,idempotent:true};
   }
   if(roomSnap.exists||pubSnap.exists)err('room-code-conflict');
   const original=d.privatePayload,publicOriginal=d.publicPayload;
   // Admin SDK bypasses Firestore Rules: reproduce the production client-create
   // field boundary explicitly, rather than spreading arbitrary client keys.
   const safePrivateKeys=new Set(['data','updatedAt','visibility','createdBy','createdByName',
    'bracketSize','archiveStatus','ladderPointsAwarded','ladderSeasonId',
    'registrationEnabled','registrationOpenAt','registrationCloseAt','registrationStatus',
    'capacity','waitlistEnabled','waitlistCapacity','confirmedCount','waitlistCount',
    'registrationVisibility','publishedAt','eventDate','checkInAt','startAt','fee',
    'timezone','assignedStaffUids','refereeStationAssignments','refereeStationNames',
    'refereeStationUids','refereeStationRestrictionEnabled',
    'tournamentPhase','location','battleMode','teamSize',
    'playMode','formatType','name','ladderMode','targetGroup','participantNameMode',
    'eventCancelled','cancellationDeadline','eventDescription','registrationNotes',
    'eventAuthority','hostName']);
   if(Object.keys(original).some(k=>!safePrivateKeys.has(k)))err('protected-create-field');
   const state=parse(original.data),mirror=parse(publicOriginal.bracketView);
   if(!state||!mirror||!state.meta||!mirror.meta)err('invalid-room-state');
   if(state.cloudCode&&state.cloudCode!==code)err('room-code-mismatch');
   // Never let a new-room request smuggle an already-started event or
   // stale referee authorization into a trusted Admin SDK write.
   if(state.ownerUid&&state.ownerUid!==uid)err('owner-mismatch');
   if(original.ownerUid&&original.ownerUid!==uid)err('owner-mismatch');
   if(state.createdByRole&&state.createdByRole!==user.role)err('owner-role-mismatch');
   // A new room must not grant arbitrary Staff rights through client-supplied
   // assignedStaffUids. The creator is added by the trusted projection.
   const safeNewRoomStaff=list=>list===undefined||
      (Array.isArray(list)&&list.every(x=>x===uid)&&list.length<=1);
   if(!safeNewRoomStaff(original.assignedStaffUids)||
      !safeNewRoomStaff(state.meta.assignedStaffUids)||
      !safeNewRoomStaff(state.assignedStaffUids))
      err('unverified-staff-assignment');
   // The current client createRoom payload includes empty legacy referee
   // fields. Accept only their inert defaults, then overwrite them atomically
   // with the canonical three-seat projection; reject forged nonempty values.
   if(['refereeSeatsV1','refereeSeatNames'].some(k=>Object.hasOwn(original,k)))err('protected-create-field');
   for(const k of ['refereeStationAssignments','refereeStationNames'])
    if(Object.hasOwn(original,k)&&(original[k]===null||typeof original[k]!=='object'||Array.isArray(original[k])||Object.keys(original[k]).length))err('protected-create-field');
   if(Object.hasOwn(original,'refereeStationUids')&&(!Array.isArray(original.refereeStationUids)||original.refereeStationUids.length))err('protected-create-field');
   if(original.refereeStationRestrictionEnabled===true)err('protected-create-field');
   if(['refereeSeatsV1','refereeSeatNames','refereeStationUids'].some(k=>Object.hasOwn(state.meta,k)))err('protected-create-field');
   if(state.meta.refereeStationRestrictionEnabled===true||Object.keys(state.meta.refereeStationNames||{}).length)err('protected-create-field');
   if(state.meta.refereeStationAssignments&&Object.values(state.meta.refereeStationAssignments).some(x=>Array.isArray(x)&&x.length))err('legacy-assignments-exist');
   if(!Array.isArray(state.players)||!Array.isArray(state.matches)||!Array.isArray(state.teams||[])||
      state.players.length||state.matches.length||(state.teams||[]).length||
      state.startedAt||state.completedAt||state.archivedAt||state.bracketSize||
      state.archiveStatus&&state.archiveStatus!=='ongoing')err('not-empty-room');
   if(!Array.isArray(mirror.players||[])||!Array.isArray(mirror.matches||[])||!Array.isArray(mirror.teams||[])||
      (mirror.players||[]).length||(mirror.matches||[]).length||(mirror.teams||[]).length||
      mirror.startedAt||mirror.bracketSize||mirror.completedAt)err('mirror-mismatch');
   if(publicOriginal.confirmedCount||publicOriginal.waitlistCount||publicOriginal.tournamentPhase==='live'||publicOriginal.tournamentPhase==='done')err('mirror-mismatch');
   // The new-room endpoint must not accept a forged live/settling/finished
   // phase even when the serialized bracket is still empty.
   if(original.tournamentPhase&&original.tournamentPhase!=='waiting'||
      publicOriginal.tournamentPhase&&publicOriginal.tournamentPhase!=='waiting'||
      original.bracketSize||original.ladderPointsAwarded===true||
      state.meta.eventCancelled===true||original.eventCancelled===true||
      publicOriginal.eventCancelled===true)
      err('not-empty-room');

   if(publicOriginal.ownerUid&&publicOriginal.ownerUid!==uid)err('owner-mismatch');
   if(publicOriginal.createdByRole&&publicOriginal.createdByRole!==user.role)err('owner-role-mismatch');
   if(publicOriginal.testMode===true)err('unsupported-mode');
   if(original.createdBy&&original.createdBy!==uid)err('owner-mismatch');
   if(state.createdBy&&state.createdBy!==uid)err('owner-mismatch');
   if(original.eventAuthority!=='official'||state.meta.eventAuthority!=='official'||publicOriginal.eventAuthority!=='official')err('unsupported-mode');
   if(original.battleMode!=='individual'||original.playMode!=='standard'||publicOriginal.battleMode!=='individual')err('unsupported-mode');
   if(original.createdByRole==='partner_organizer'||state.createdByRole==='partner_organizer'||original.partnerContractOrderCode)err('partner-path-not-supported');
   if(original.testMode||state.testMode||state.meta.ladderMode==='ranked'&&user.role==='staff')err('unsupported-mode');
   if(state.startedAt||state.bracketSize||state.matches?.length||state.players?.length||original.confirmedCount||original.waitlistCount)err('not-empty-room');
   if(mirror.cloudCode&&mirror.cloudCode!==code)err('mirror-mismatch');
   if(mirror.meta.eventAuthority!=='official'||mirror.meta.battleMode!=='individual'||mirror.meta.stations!==state.meta.stations)err('mirror-mismatch');
   // Do not accept arbitrary public payload fields from a client, even an admin.
   const safePublicKeys=new Set(['bracketView','updatedAt','visibility','registrationEnabled','registrationOpenAt','registrationCloseAt','registrationStatus','capacity','waitlistEnabled','waitlistCapacity','confirmedCount','waitlistCount','registrationVisibility','publishedAt','eventDate','checkInAt','startAt','fee','timezone','tournamentPhase','location','battleMode','teamSize','playMode','formatType','name','ladderMode','targetGroup','participantNameMode','eventCancelled','cancellationDeadline','eventDescription','registrationNotes','eventAuthority','ownerUid','hostName','lastActivityAt','expiresAt','testMode','testLabel','createdByRole','testCreatedAt','testExpiresAt']);
   if(Object.keys(publicOriginal).some(k=>!safePublicKeys.has(k)))err('private-mirror-data');
   // Root/meta whitelists mirror the production public bracket serializer.
   const safeMirrorKeys=new Set(['courtLifecycleEpoch','callRevision','registrationRosterRevision','onsiteWaitlistRuntimeRevision','systemClosure','eventInfo','meta','testMode','testCreatedAt','testExpiresAtMs','players','teams','matches','courtAssignments','bracketSize','drawnAt','archiveStatus','startedAt','completedAt','archivedAt','ladderPointsAwarded','championId','runnerUpId','thirdId','fourthId','gfMatchId','gfResetMatchId','bronzeMatchId','rrRounds','teamResultRevision','teamStandings']);
   const safeMetaKeys=new Set(['name','location','date','battleMode','teamSize','playMode','formatType','format','ladderMode','startTime','checkin','bronzeMatch','stations','refereeStationRestrictionEnabled','refereeStationNames','eventAuthority','communityQuickRegistration']);
   if(Object.keys(mirror).some(k=>!safeMirrorKeys.has(k))||Object.keys(mirror.meta).some(k=>!safeMetaKeys.has(k)))err('private-mirror-data');
   // Public event-info may contain freeform rule text, but never arbitrary
   // object keys. Mirror the explicit frontend buildPublicEventInfo whitelist.
   const only=(obj,keys)=>obj===null||obj===undefined||
    (typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).every(k=>keys.includes(k)));
   const info=mirror.eventInfo;
   if(!only(info,['schemaVersion','venue','standardTemplate']))err('private-mirror-data');
   if(info&&(!only(info.venue,['name','address','googleMapsUrl','navigationEnabled'])||
      !only(info.standardTemplate,['enabled','templateId','version','versionLabel','snapshot'])||
      !only(info.standardTemplate?.snapshot,['id','name','version','versionLabel','rules','notices','legalPositioning'])))
      err('private-mirror-data');
   // New rooms must have no active court routing or historical bracket data.
   if(mirror.courtAssignments&&Object.keys(mirror.courtAssignments).length)err('mirror-mismatch');
   if(mirror.meta.playMode&&mirror.meta.playMode!=='standard')err('mirror-mismatch');
   if(mirror.meta.refereeStationRestrictionEnabled===true||Object.keys(mirror.meta.refereeStationNames||{}).length)err('mirror-mismatch');
   const mirrorText=JSON.stringify(mirror);
   if(/"(?:uid|phone|email|assignedStaffUids|refereeSeatsV1|refereeStationAssignments|refereeStationUids|requests)"\s*:/.test(mirrorText))err('private-mirror-data');
   const result=initialize({state,ownerUid:uid,release:releaseSnap.data()});
   if(!result.ok)err(result.reason);
   const now=clock();
   state.createdBy=uid;state.meta=result.privateMeta;
   const privatePayload={...original,createdBy:uid,createdByName:user.realName||user.displayName||'',
    data:JSON.stringify(state),...result.privateFields,updatedAt:now};
   mirror.meta={...mirror.meta,refereeStationNames:result.publicMeta.refereeStationNames,
    refereeStationRestrictionEnabled:true,refereeSeatNames:result.publicMeta.refereeSeatNames};
   delete mirror.meta.refereeSeatsV1;delete mirror.meta.assignedStaffUids;
   delete mirror.meta.refereeStationAssignments;delete mirror.meta.refereeStationUids;
   const publicPayload={...publicOriginal,bracketView:JSON.stringify(mirror),updatedAt:now};
   for(const key of ['assignedStaffUids','refereeSeatsV1','refereeStationAssignments','refereeStationUids','refereeSeatNames'])
    if(Object.hasOwn(publicPayload,key))err('private-mirror-data');
   tx.create(roomRef,privatePayload);tx.create(pubRef,publicPayload);
   tx.create(receiptRef,{uid,hash,code,at:now});
   return {ok:true,code,idempotent:false};
  });
 };
}
module.exports={createHandler};
