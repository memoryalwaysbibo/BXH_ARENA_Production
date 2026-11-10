'use strict';
const {createHash}=require('node:crypto');
const activeAccount=p=>!!p&&p.active===true&&p.isTestAccount!==true&&p.deleted!==true&&!['deleted','disabled','frozen'].includes(p.accountStatus);
const fail=code=>{throw Error(code);};
function parse(value){try{const s=typeof value==='string'?JSON.parse(value):value;if(!s||typeof s!=='object'||Array.isArray(s))fail('corrupt-state');return s;}catch{fail('corrupt-state');}}
function authorized(user,uid,room){
 if(!activeAccount(user))return false;
 if(['admin','super_admin'].includes(user.role))return true;
 return user.role==='staff'&&(!Object.hasOwn(room,'assignedStaffUids')||Array.isArray(room.assignedStaffUids)&&(room.assignedStaffUids.length===0||room.assignedStaffUids.includes(uid)));
}
function createPromotionHandler(db,{clock=Date.now,timestamp=()=>clock(),allowUnseatedOfficial=false,rejectV2OwnedRoom=false}={}){return async req=>{
 const uid=req.auth?.uid,d=req.data||{};
 if(!uid)fail('unauthenticated');
 const demote=d.action==='demote',add=d.action==='addLocal',local=d.localId!==undefined;
 const target=local?d.localId:d.registrationId;
 const validTarget=typeof target==='string'&&(local
  ? allowUnseatedOfficial&&!demote&&d.registrationId===undefined&&/^[A-Za-z0-9_-]{1,200}$/.test(target)
  : /^[A-Za-z0-9_-]{1,128}$/.test(target));
 const validNames=add&&Array.isArray(d.names)&&d.names.length>0&&d.names.length<=320&&d.names.every(name=>typeof name==='string'&&name===name.trim()&&name.length>0&&name.length<=100&&!/[\r\n\x00]/.test(name));
 if((d.action!==undefined&&(!allowUnseatedOfficial||(!demote&&!add)||d.expandBy!==undefined))||
    (add?(!validNames||d.registrationId!==undefined||local):(d.names!==undefined||!validTarget))||
    Object.keys(d).some(k=>!['code','registrationId','expandBy','operationId','action','localId','names'].includes(k))||!/^BXH-[A-Z0-9]{4,16}$/.test(d.code||'')||!/^[-A-Za-z0-9]{16,80}$/.test(d.operationId||'')||![0,8].includes(d.expandBy??0))fail('invalid-request');
 const expandBy=d.expandBy??0,ref=db.doc('tournaments/'+d.code),pubRef=db.doc('publicTournaments/'+d.code),regRef=local||add?null:ref.collection('registrations').doc(target);
 const operationKey=createHash('sha256').update(uid+':'+d.operationId).digest('hex');
 const op=ref.collection('rosterPromotionOperations').doc(operationKey);
 const guestIds=add?d.names.map((_,index)=>'guest_'+operationKey.slice(0,24)+'_'+index):[];
 const hash=createHash('sha256').update(JSON.stringify(add?[d.code,d.names,'addLocal']:local?[d.code,target,expandBy,'local']:demote?[d.code,target,'demote']:[d.code,target,expandBy])).digest('hex');
 return db.runTransaction(async tx=>{
  const [ts,ps,rs,us,os]=await Promise.all([tx.get(ref),tx.get(pubRef),regRef?tx.get(regRef):null,tx.get(db.doc('users/'+uid)),tx.get(op)]);
  if(!ts.exists||!ps.exists||(regRef&&!rs.exists))fail('not-found');
  const t=ts.data(),pub=ps.data(),reg=rs?.data(),user=us.data();
  if(!authorized(user,uid,t))fail('permission-denied');
  if(add&&user.role==='staff'&&![t.ownerUid,t.createdBy].includes(uid))fail('permission-denied');
  if(local&&user.role==='staff'&&![t.ownerUid,t.createdBy].includes(uid)){
   if(expandBy)fail('permission-denied');
   const configuration=await tx.get(db.doc('systemConfig/staffPromotion'));
   if(configuration.data()?.enabled!==true)fail('permission-denied');
  }
  if(Object.prototype.hasOwnProperty.call(t,'scoreStorage'))fail('bucket-scoring-required');
  const state=parse(t.data),mirror=parse(pub.bracketView);
  // The existing callable remains limited to seat-enabled official rooms.
  if(t.eventAuthority!=='official'||pub.eventAuthority!=='official'||t.createdByRole==='partner_organizer'||(!allowUnseatedOfficial&&t.refereeSeatsV1?.version!==1))fail('promotion-route-not-supported');
  if([t.battleMode,pub.battleMode,state.meta?.battleMode].includes('team'))fail('team-roster-managed');
  if([t,pub].some(x=>x.systemClosed||x.eventCancelled||x.deletionStatus||x.tournamentPhase!=='waiting'||['completed','archived'].includes(x.archiveStatus))||state.meta?.eventCancelled||state.startedAt||state.bracketSize||['completed','archived'].includes(state.archiveStatus))fail('bracket-locked');
  if(allowUnseatedOfficial&&(t.createdByRole==='tester'||t.testMode===true||pub.testMode===true||[t,pub].some(room=>room.createdByRole==='partner_organizer'||room.partnerOrganizationCode||room.partnerContractOrderCode)))fail('promotion-route-not-supported');
  if(t.registrationSelection||pub.registrationSelection||state.entrySelection?.mode==='registration')fail('selection-managed');
  if(t.onsiteWaitlistServerOwned||pub.onsiteWaitlistServerOwned||state.onsiteWaitlistServerOwned)fail('onsite-waitlist-managed');
  if(local||add){
   if(Number(t.callRevision||0)!==Number(state.callRevision||0))fail('call-state-stale');
   if(Number(t.entrySelectionRevision||0)!==Number(state.entrySelectionRevision||0))fail('entry-selection-stale');
  }
  if(os.exists){
   if(os.data().hash!==hash)fail('operation-conflict');
   if(add){
    if(!guestIds.every(id=>state.players?.some(p=>p.id===id)&&mirror.players?.some(p=>p.id===id)))fail('operation-outdated');
    return {...os.data().result,state,replayed:true};
   }
   // A later demotion/cancellation supersedes this receipt. Never report an old
   // success as the current result or silently promote again with the old intent.
   const candidate=(state.players||[]).find(p=>local?String(p.id)===target:String(p.registrationId||'')===target);
   const visible=candidate&&(mirror.players||[]).some(p=>String(p.id)===String(candidate.id));
   const projected=demote?(!candidate&&(state.waitlistPlayers||[]).some(p=>String(p.registrationId||'')===d.registrationId)):visible;
   if((!local&&reg.status!==(demote?'waitlist':'confirmed'))||!projected||t.confirmedCount!==pub.confirmedCount||t.waitlistCount!==pub.waitlistCount)fail('operation-outdated');
   return {...os.data().result,capacity:t.capacity,confirmedCount:t.confirmedCount,waitlistCount:t.waitlistCount,state,replayed:true};
  }
  if(rejectV2OwnedRoom&&t.registrationQueueVersion===2)fail('registration-queue-required');
  if(regRef&&reg.status!==(demote?'confirmed':'waitlist'))fail(demote?'not-confirmed':'not-waitlist');
  const capacity=t.capacity,confirmed=t.confirmedCount,waiting=t.waitlistCount;
  if(!Number.isSafeInteger(capacity)||capacity<1||!Number.isSafeInteger(confirmed)||confirmed<(demote?1:0)||!Number.isSafeInteger(waiting)||waiting<(demote||local||add?0:1)||pub.capacity!==capacity||pub.confirmedCount!==confirmed||pub.waitlistCount!==waiting||confirmed>capacity)fail('registration-state-conflict');
  if(!state.meta||!Array.isArray(state.players)||!Array.isArray(state.waitlistPlayers)||!Array.isArray(mirror.players))fail('corrupt-state');
  const occupied=rows=>Math.max(rows.length,confirmed+rows.filter(p=>p&&p.source!=='online'&&!p.registrationId).length);
  const full=occupied(state.players)>=capacity;
  if(!demote&&full&&expandBy!==8)fail('capacity-full');
  const nextCapacity=!demote&&full?capacity+8:capacity;
  if(!Number.isSafeInteger(nextCapacity))fail('invalid-capacity-step');
  let matches,player;
  if(add){
   if(guestIds.some(id=>[...state.players,...state.waitlistPlayers,...mirror.players].some(p=>p?.id===id)))fail('operation-conflict');
   for(const [index,name] of d.names.entries())state.players.push({
    id:guestIds[index],name,checkedIn:!state.meta.checkinRequired,source:'onsite',participantType:'onsite_guest',
    accountLinked:false,playerUid:null,playerId:null,ladderEligible:false,activityEligible:false
   });
   state.testDataDismissed=true;
  }else if(local){
   matches=p=>p&&String(p.id)===target;
   const candidates=state.waitlistPlayers.filter(matches);
   if(candidates.length!==1||state.players.some(matches)||mirror.players.some(matches))fail('not-waitlist');
   const candidate=candidates[0];
   if(candidate.registrationId||candidate.registrationUid||candidate.source==='online')fail('online-registration-required');
   if(['cancelled','withdrawn','not_selected'].includes(candidate.status))fail('not-waitlist');
   player={...candidate,status:'confirmed'};
  }else{
   const guardian=String(reg.guardianUid||reg.uid||''),family=String(reg.familyPlayerId||'');
   matches=p=>p&&(String(p.registrationId||'')===target||guardian&&String(p.registrationUid||p.guardianUid||'')===guardian&&(family?String(p.familyPlayerId||'')===family:!p.familyPlayerId));
   const existing=state.players.find(matches)||state.waitlistPlayers.find(matches);
   player={...(existing||{}),id:family?'family_'+family:existing?.id||'reg_'+target,name:String(reg.displayName||reg.publicName||reg.participantName||reg.realName||existing?.name||'未命名選手'),source:'online',registrationId:target,registrationUid:guardian,checkedIn:existing?existing.checkedIn===true:!state.meta.checkinRequired};
   if(family)Object.assign(player,{familyPlayerId:family,participantId:family,guardianUid:guardian});
  }
  const onlineDelta=local||add?0:demote?-1:1;
  const nextConfirmed=confirmed+onlineDelta,nextWaiting=waiting-onlineDelta;
  if(!add){
   delete player.waitRank;delete player.waitlistedAt;
   state.players=state.players.filter(p=>!matches(p));
   state.waitlistPlayers=state.waitlistPlayers.filter(p=>!matches(p));
   if(demote)state.waitlistPlayers.push({...player,waitRank:nextWaiting,waitlistedAt:clock()});
   else state.players.push(player);
  }
  const nextOccupied=Math.max(state.players.length,nextConfirmed+state.players.filter(p=>p&&p.source!=='online'&&!p.registrationId).length);
  if(nextOccupied>nextCapacity)fail('capacity-full');
  let status=String(t.registrationStatus||'');
  if(!['scheduled','open','full','closed'].includes(status)||pub.registrationStatus!==status)fail('registration-state-conflict');
  if(status==='full'&&nextOccupied<nextCapacity)status='open';
  if(['open','full'].includes(status)&&nextOccupied>=nextCapacity)status='full';
  const now=Math.max(clock(),Number(t.updatedAt||0)+1,Number(state.updatedAt||0)+1);
  state.meta.registrationCapacity=nextCapacity;state.meta.registrationStatus=status;
  state.registrationRosterRevision=Number(state.registrationRosterRevision||0)+1;state.updatedAt=now;
  const fence={};
  if(t.qrCheckinManaged===true){
   const revision=t.qrCheckinRevision;
   if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER||pub.qrCheckinManaged!==true||pub.qrCheckinRevision!==revision||state.qrCheckinRevision!==revision)fail('qr-checkin-stale');
   fence.qrCheckinRevision=state.qrCheckinRevision=revision+1;mirror.qrCheckinRevision=revision+1;
  }else if(pub.qrCheckinManaged===true)fail('qr-checkin-stale');
  if(Number(t.courtLifecycleEpoch||0)>0){
   const seq=t.courtLifecycleWriteSeq;
   if(!Number.isSafeInteger(seq)||seq<0||seq>=Number.MAX_SAFE_INTEGER||state.courtLifecycleEpoch!==t.courtLifecycleEpoch)fail('court-lifecycle-stale');
   fence.courtLifecycleWriteSeq=seq+1;
   mirror.courtLifecycleEpoch=t.courtLifecycleEpoch;
  }
  // Preserve the sanitized public metadata; do not copy private runtime fields.
  mirror.players=state.players.map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn===true}));
  mirror.registrationRosterRevision=state.registrationRosterRevision;mirror.updatedAt=now;
  mirror.meta={...(mirror.meta||{}),registrationCapacity:nextCapacity,registrationStatus:status};
  const data=JSON.stringify(state),bracketView=JSON.stringify(mirror);
  if(Buffer.byteLength(data)>900000||Buffer.byteLength(bracketView)>900000)fail('roster-too-large');
  const common={capacity:nextCapacity,confirmedCount:nextConfirmed,waitlistCount:nextWaiting,registrationStatus:status,updatedAt:now,lastRegistrationMutationUid:add?guestIds[0]:target,lastRegistrationMutationType:add?'add_local':demote?'demote':(local?'promote_local':'promote')+(nextCapacity===capacity?'':'_expand8'),lastRegistrationMutationBy:uid};
  const participantStatus=add?'added':demote?'waitlist':'confirmed';
  const mutation=demote?{waitRank:nextWaiting}:{promotedBy:uid,promotedAt:timestamp()};
  if(regRef)tx.update(regRef,{...mutation,status:participantStatus,updatedAt:timestamp()});
  tx.update(ref,{...common,...fence,data});
  const publicFence=t.qrCheckinManaged===true?{qrCheckinRevision:fence.qrCheckinRevision}:{};
  tx.update(pubRef,{...common,...publicFence,bracketView});
  const result={ok:true,verified:true,capacity:nextCapacity,confirmedCount:nextConfirmed,waitlistCount:nextWaiting,status:participantStatus,...(add?{addedCount:guestIds.length,checkedIn:!state.meta.checkinRequired}:local?{localId:target,expanded:nextCapacity!==capacity}:{registrationId:target,participantRegistrationId:target,registrationChanges:[{registrationId:target,status:participantStatus}]})};
  tx.create(op,{actorUid:uid,hash,result,createdAt:now});
  return {...result,state};
 });
};}
module.exports={createPromotionHandler,authorized};
