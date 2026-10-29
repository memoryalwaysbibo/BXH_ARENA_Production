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
function createPromotionHandler(db,{clock=Date.now,timestamp=()=>clock()}={}){return async req=>{
 const uid=req.auth?.uid,d=req.data||{};
 if(!uid)fail('unauthenticated');
 if(Object.keys(d).some(k=>!['code','registrationId','expandBy','operationId'].includes(k))||!/^BXH-[A-Z0-9]{4,16}$/.test(d.code||'')||!/^[A-Za-z0-9_-]{1,128}$/.test(d.registrationId||'')||!/^[-A-Za-z0-9]{16,80}$/.test(d.operationId||'')||![0,8].includes(d.expandBy??0))fail('invalid-request');
 const expandBy=d.expandBy??0,ref=db.doc('tournaments/'+d.code),pubRef=db.doc('publicTournaments/'+d.code),regRef=ref.collection('registrations').doc(d.registrationId);
 const op=ref.collection('rosterPromotionOperations').doc(createHash('sha256').update(uid+':'+d.operationId).digest('hex'));
 const hash=createHash('sha256').update(JSON.stringify([d.code,d.registrationId,expandBy])).digest('hex');
 return db.runTransaction(async tx=>{
  const [ts,ps,rs,us,os]=await Promise.all([tx.get(ref),tx.get(pubRef),tx.get(regRef),tx.get(db.doc('users/'+uid)),tx.get(op)]);
  if(!ts.exists||!ps.exists||!rs.exists)fail('not-found');
  const t=ts.data(),pub=ps.data(),reg=rs.data();
  if(!authorized(us.data(),uid,t))fail('permission-denied');
  const state=parse(t.data),mirror=parse(pub.bracketView);
  // This server-owned path is deliberately limited to the seat-enabled official
  // individual rooms whose browser runtime writes are protected by seat Rules.
  if(t.eventAuthority!=='official'||pub.eventAuthority!=='official'||t.createdByRole==='partner_organizer'||t.refereeSeatsV1?.version!==1)fail('promotion-route-not-supported');
  if([t.battleMode,pub.battleMode,state.meta?.battleMode].includes('team'))fail('team-roster-managed');
  if([t,pub].some(x=>x.systemClosed||x.eventCancelled||x.deletionStatus||x.tournamentPhase!=='waiting'||['completed','archived'].includes(x.archiveStatus))||state.startedAt||state.bracketSize||['completed','archived'].includes(state.archiveStatus))fail('bracket-locked');
  if(t.registrationSelection||pub.registrationSelection||state.entrySelection?.mode==='registration')fail('selection-managed');
  if(t.onsiteWaitlistServerOwned||pub.onsiteWaitlistServerOwned||state.onsiteWaitlistServerOwned)fail('onsite-waitlist-managed');
  if(os.exists){if(os.data().hash!==hash)fail('operation-conflict');return {...os.data().result,state,replayed:true};}
  if(reg.status!=='waitlist')fail('not-waitlist');
  const capacity=t.capacity,confirmed=t.confirmedCount,waiting=t.waitlistCount;
  if(!Number.isSafeInteger(capacity)||capacity<1||!Number.isSafeInteger(confirmed)||confirmed<0||!Number.isSafeInteger(waiting)||waiting<1||pub.capacity!==capacity||pub.confirmedCount!==confirmed||pub.waitlistCount!==waiting||confirmed>capacity)fail('registration-state-conflict');
  if(!state.meta||!Array.isArray(state.players)||!Array.isArray(state.waitlistPlayers)||!Array.isArray(mirror.players))fail('corrupt-state');
  const guardian=String(reg.guardianUid||reg.uid||''),family=String(reg.familyPlayerId||'');
  const matches=p=>p&&(String(p.registrationId||'')===d.registrationId||guardian&&String(p.registrationUid||p.guardianUid||'')===guardian&&(family?String(p.familyPlayerId||'')===family:!p.familyPlayerId));
  const existing=state.players.find(matches)||state.waitlistPlayers.find(matches);
  const occupied=rows=>Math.max(rows.length,confirmed+rows.filter(p=>p&&p.source!=='online'&&!p.registrationId).length);
  const full=occupied(state.players)>=capacity;
  if(full&&expandBy!==8)fail('capacity-full');
  const nextCapacity=full?capacity+8:capacity;
  if(!Number.isSafeInteger(nextCapacity))fail('invalid-capacity-step');
  const player={...(existing||{}),id:family?'family_'+family:existing?.id||'reg_'+d.registrationId,name:String(reg.displayName||reg.publicName||reg.participantName||reg.realName||existing?.name||'未命名選手'),source:'online',registrationId:d.registrationId,registrationUid:guardian,checkedIn:existing?existing.checkedIn===true:!state.meta.checkinRequired};
  if(family)Object.assign(player,{familyPlayerId:family,participantId:family,guardianUid:guardian});
  delete player.waitRank;delete player.waitlistedAt;
  state.players=state.players.filter(p=>!matches(p)).concat(player);
  state.waitlistPlayers=state.waitlistPlayers.filter(p=>!matches(p));
  const nextConfirmed=confirmed+1,nextWaiting=waiting-1;
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
  }
  // Preserve the sanitized public metadata; do not copy private runtime fields.
  mirror.players=state.players.map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn===true}));
  mirror.registrationRosterRevision=state.registrationRosterRevision;mirror.updatedAt=now;
  mirror.meta={...(mirror.meta||{}),registrationCapacity:nextCapacity,registrationStatus:status};
  const data=JSON.stringify(state),bracketView=JSON.stringify(mirror);
  if(Buffer.byteLength(data)>900000||Buffer.byteLength(bracketView)>900000)fail('roster-too-large');
  const common={capacity:nextCapacity,confirmedCount:nextConfirmed,waitlistCount:nextWaiting,registrationStatus:status,updatedAt:now,lastRegistrationMutationUid:d.registrationId,lastRegistrationMutationType:nextCapacity===capacity?'promote':'promote_expand8',lastRegistrationMutationBy:uid};
  tx.update(regRef,{status:'confirmed',promotedBy:uid,promotedAt:timestamp(),updatedAt:timestamp()});
  tx.update(ref,{...common,...fence,data});
  const publicFence=t.qrCheckinManaged===true?{qrCheckinRevision:fence.qrCheckinRevision}:{};
  tx.update(pubRef,{...common,...publicFence,bracketView});
  const result={ok:true,verified:true,capacity:nextCapacity,confirmedCount:nextConfirmed,waitlistCount:nextWaiting,status:'confirmed',registrationId:d.registrationId,participantRegistrationId:d.registrationId,registrationChanges:[{registrationId:d.registrationId,status:'confirmed'}]};
  tx.create(op,{actorUid:uid,hash,result,createdAt:now});
  return {...result,state};
 });
};}
module.exports={createPromotionHandler,authorized};
