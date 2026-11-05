'use strict';
const {FieldValue}=require("./_qr_checkin/admin-firestore.cjs");
const {createHash}=require('node:crypto');
const {operationFields}=require('./my-events-operation-proof.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const Access=require('./room-access-core');
const Onsite=require('./onsite-waitlist-writer-guards');
const {quickPolicy,quickParticipants}=require('./community-registration-policy');
const {reconcileQuickRoster,assertPendingBracketOnly}=require('./community-registration-roster');
const active=p=>p?.active===true&&!p.deleted&&!['deleted','disabled','frozen'].includes(p.accountStatus);
const ms=x=>x?.toMillis?x.toMillis():Number(x)||0;
function state(t){try{return JSON.parse(t.data||'{}');}catch{return {};}}
const childKey=id=>'family_'+id;
// Admission only: the existing database transaction remains authoritative across
// processes. Sharing this module-level scheduler also covers per-request factories.
const {createAdmission}=require('./registration-admission.cjs');
const admit=createAdmission();
function createFamilyRegistration(db,clock=Date.now,{myEventsProofEnabled=false}={}){const handle=async req=>{
 const uid=req.auth?.uid,d=req.data||{},now=clock();if(!uid)throw Error('auth-required');
 const user=await db.doc('users/'+uid).get();if(!active(user.data()))throw Error('auth-required');
 const code=String(d.code||'').toUpperCase();
 if(d.action==='history'){
  const fs=await db.doc('familyPlayers/'+uid).get();if(!(fs.data()?.profiles||[]).some(p=>p.id===d.childId))throw Error('child-not-found');
  const refs=await db.collection(`familyPlayers/${uid}/registrations`).where('childId','==',d.childId).get(),rows=[],seen=new Set();
  for(const ref of refs.docs){const code=ref.data().code||ref.id;if(seen.has(code))continue;seen.add(code);const [ts,rs,legacy]=await Promise.all([db.doc('tournaments/'+code).get(),db.doc(`tournaments/${code}/registrations/${childKey(d.childId)}`).get(),db.doc(`tournaments/${code}/registrations/${uid}`).get()]);const reg=rs.exists?rs.data():legacy.data();if(!ts.exists||reg?.familyPlayerId!==d.childId||reg?.guardianUid!==uid)continue;const t=ts.data(),s=state(t),p=(s.players||[]).find(p=>p.familyPlayerId===d.childId),matches=(s.matches||[]).filter(m=>p&&!m.isBye&&m.completed&&[m.a?.playerId,m.b?.playerId].includes(p.id));rows.push({code,title:t.name||s.meta?.name||code,participantName:reg.displayName,status:reg.status,checkedIn:!!p?.checkedIn,completed:s.archiveStatus==='completed',wins:matches.filter(m=>m.winnerId===p.id).length,losses:matches.filter(m=>m.winnerId&&m.winnerId!==p.id).length,createdAt:ref.data().createdAt});}
  return {ok:true,rows:rows.sort((a,b)=>b.createdAt-a.createdAt)};
 }
 if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');
 const tr=db.doc('tournaments/'+code),pr=db.doc('publicTournaments/'+code),fr=db.doc('familyPlayers/'+uid);
 if(d.action==='mine'){
  const [self,children]=await Promise.all([tr.collection('registrations').doc(uid).get(),tr.collection('registrations').where('guardianUid','==',uid).get()]);const rows=new Map();for(const doc of [self,...children.docs])if(doc.exists&&(doc.id===uid||doc.data().guardianUid===uid))rows.set(doc.id,{...doc.data(),registrationId:doc.id,createdAt:ms(doc.data().createdAt)});return {ok:true,rows:[...rows.values()]};
 }
 if(!['preview','join','cancel','syncSummary'].includes(d.action)||d.action!=='preview'&&!/^[a-zA-Z0-9_-]{8,100}$/.test(d.operationId||''))throw Error('invalid-operation');
 return db.runTransaction(async tx=>{
  const ar=fr.collection('registrationActions').doc(hash(d.operationId||'preview'));
  const [ts,ps,us,fs,op]=await tx.getAll(tr,pr,db.doc('users/'+uid),fr,ar);if(!active(us.data()))throw Error('auth-required');if(!ts.exists||!ps.exists)throw Error('not-found');
  const now=clock(); // Revalidate deadlines after admission, lock waits and SDK retries.
  const t=ts.data(),pub=ps.data(),u=us.data(),s=state(t),requestHash=hash(JSON.stringify(d)),profiles=fs.data()?.profiles||[];
  if(['preview','join'].includes(d.action)&&Access.normalizeMode(t.roomAccessMode)==='password'&&!Access.canBypass(uid,u,t)){const grant=await tx.get(tr.collection('accessGrants').doc(uid));if(!Access.grantValid(grant.data(),t,now))throw Error('room-password-required');}
  if(d.action!=='preview'&&op.exists){if(op.data().requestHash!==requestHash)throw Error('operation-conflict');return {...op.data().result,ok:true,replayed:true};}
  const onsiteOwned=Onsite.onsiteWaitlistOwned(t,pub,s);
  if(onsiteOwned&&d.action!=='cancel')throw Error('onsite-waitlist-managed');
  const quick=quickPolicy(t,pub);let mirror;
  if(quick){
   try{const runtime=JSON.parse(t.data);if(!runtime||typeof runtime!=='object'||Array.isArray(runtime)||!Array.isArray(runtime.players))throw Error('corrupt-state');}
   catch{throw Error('corrupt-state');}
   try{mirror=JSON.parse(pub.bracketView);if(!mirror||typeof mirror!=='object'||Array.isArray(mirror))throw Error('corrupt-state');}
   catch{throw Error('corrupt-state');}
  }
  if(t.registrationSelection||pub.registrationSelection||quick&&s.entrySelection?.mode==='registration')throw Error('family-lottery-unavailable');
  if(t.systemClosed||t.eventCancelled||s.meta?.eventCancelled||s.startedAt||s.archiveStatus==='completed'||t.archiveStatus==='completed'||t.tournamentPhase!=='waiting')throw Error('tournament-started');
  if(Number(pub.confirmedCount||0)!==Number(t.confirmedCount||0)||Number(pub.waitlistCount||0)!==Number(t.waitlistCount||0))throw Error('registration-state-conflict');
  if(d.action==='syncSummary'&&(!quick||t.ownerUid!==uid||t.createdBy!==uid||pub.ownerUid!==uid))throw Error('permission-denied');
  const managedRows=onsiteOwned?await Onsite.readManagedRows(tx,tr):null;
  const quickRows=quick?(managedRows||(await tx.get(tr.collection('registrations'))).docs.map(doc=>({...doc.data(),registrationId:doc.id}))):null;
  if(quick){
   if(pub.systemClosed||pub.eventCancelled||pub.archiveStatus==='completed'||pub.tournamentPhase!=='waiting')throw Error('tournament-started');
   assertPendingBracketOnly(t,pub,s,mirror);
   for(const [field,status]of [['confirmedCount','confirmed'],['waitlistCount','waitlist']])if(!Number.isSafeInteger(t[field])||t[field]<0||pub[field]!==t[field]||quickRows.filter(row=>row.status===status).length!==t[field])throw Error('registration-state-conflict');
  }
  const project=rows=>{
   const result=reconcileQuickRoster(s,mirror,rows,{allowPendingBracketChanges:true,roomCode:code});
   if(result.changed){result.state.updatedAt=now;result.mirror.updatedAt=now;}
   const scalarChanged=t.communityParticipantCount!==result.communityParticipantCount||pub.communityParticipantCount!==result.communityParticipantCount;
   const fields={communityParticipantCount:result.communityParticipantCount,...(result.changed||scalarChanged?{updatedAt:now}:{})};
   return {...result,private:{...fields,data:JSON.stringify(result.state)},public:{...fields,bracketView:JSON.stringify(result.mirror)}};
  };
  if(d.action==='syncSummary'){
   const projection=project(quickRows),communityParticipantCount=projection.communityParticipantCount;
   if(projection.changed||t.communityParticipantCount!==communityParticipantCount||pub.communityParticipantCount!==communityParticipantCount){tx.update(tr,projection.private);tx.update(pr,projection.public);}
   return {ok:true,communityParticipantCount};
  }
  if(d.action==='cancel'){
   const id=String(d.registrationId||uid);if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('invalid-operation');const rr=tr.collection('registrations').doc(id),rs=await tx.get(rr),reg=rs.data();if(!reg||(id!==uid&&reg.guardianUid!==uid))throw Error('not-registered');if(quick ? (quick.cancellationDeadline!==null&&now>=quick.cancellationDeadline) : (!ms(t.cancellationDeadline)||now>=ms(t.cancellationDeadline)))throw Error('cancel-deadline-passed');
   const projection=onsiteOwned?(reg.status==='cancelled'?null:Onsite.projectManagedCancellation(t,pub,managedRows,id,{uid,now})):(quick?project(quickRows.map(row=>row.registrationId===id?{...row,status:'cancelled'}:row)):null);
   const result={ok:true};if(reg.status!=='cancelled'){if(!['confirmed','waitlist'].includes(reg.status))throw Error('nothing-to-cancel');const field=reg.status==='confirmed'?'confirmedCount':'waitlistCount';if(Number(t[field])<1)throw Error('registration-state-conflict');tx.update(rr,{status:'cancelled',cancelledAt:FieldValue.serverTimestamp(),cancelledBy:uid,updatedAt:FieldValue.serverTimestamp()});tx.update(tr,{[field]:FieldValue.increment(-1),updatedAt:now,...projection?.private});tx.update(pr,{[field]:FieldValue.increment(-1),updatedAt:now,...projection?.public});}
   else if(projection&&(projection.changed||t.communityParticipantCount!==projection.communityParticipantCount||pub.communityParticipantCount!==projection.communityParticipantCount)){tx.update(tr,projection.private);tx.update(pr,projection.public);}
   const proofFields=myEventsProofEnabled===true?operationFields(uid,code,'cancel',ts.createTime,[{id,mode:reg.status==='cancelled'?'observed':'write',...(reg.status==='cancelled'?{observedUpdateTime:rs.updateTime}:{})}],now):{};
   tx.create(ar,{action:'cancel',actorUid:uid,code,registrationId:id,requestHash,result,createdAt:now,...proofFields});return result;
  }
  if(t.registrationEnabled!==true||pub.registrationEnabled!==true||t.visibility!=='public'||t.registrationVisibility!=='public'||pub.registrationVisibility!=='public'||!t.publishedAt)throw Error('not-enabled');
  if(quick){
   if(quick.openAt!==null&&now<quick.openAt)throw Error('not-open-yet');
   if(quick.closeAt!==null&&now>=quick.closeAt)throw Error('closed');
  }else{
   if(now<ms(t.registrationOpenAt)||!ms(t.registrationOpenAt))throw Error('not-open-yet');if(now>=ms(t.registrationCloseAt))throw Error('closed');
  }
  if(!u.realName||typeof u.phone!=='string'||!(u.profileCompleted||['staff','admin','super_admin','tester'].includes(u.role)))throw Error('profile-incomplete');
  const selected=Array.isArray(d.childIds)?d.childIds:[d.childId||null];if(!selected.length||selected.length>21||new Set(selected).size!==selected.length||selected.some(x=>x!==null&&typeof x!=='string'))throw Error('invalid-participants');
  // Family players remain independent tournament identities in ranked events.
  // Account based ladder points and activity rewards must never fall through to the guardian.
  const people=selected.map(id=>{if(id===null)return {key:uid,child:null};const child=profiles.find(x=>x.id===id&&!x.archived&&!x.accountUid&&x.guardianUid===uid);if(!child)throw Error('child-not-found');if(s.bracketSize||(s.matches||[]).length)throw Error('roster-locked');return {key:childKey(id),child};});
  if((t.targetGroup||pub.targetGroup)==='children'&&d.childEligibilityConfirmed!==true)throw Error('child-eligibility-required');
  // Legacy v13.37 put a child in the guardian's registration slot. Move that document atomically, without changing counters.
  const legacyRef=tr.collection('registrations').doc(uid),legacy=await tx.get(legacyRef),old=legacy.data();const migrating=old?.familyPlayerId?old:null;
  const keys=[...new Set([...people.map(x=>x.key),...(migrating?[childKey(migrating.familyPlayerId)]:[])])];
  const snapshots=await Promise.all(keys.map(k=>k===uid?legacy:tx.get(tr.collection('registrations').doc(k))));const existing=new Map(keys.map((k,i)=>[k,snapshots[i].data()]));
  if(migrating){const target=childKey(migrating.familyPlayerId);if(existing.get(target))throw Error('registration-state-conflict');existing.set(target,migrating);existing.delete(uid);}
  const participants=quick?quickParticipants(s,quickRows):null;
  let occupied=participants?participants.count:0;
  let confirmed=Number(t.confirmedCount||0),waitlist=Number(t.waitlistCount||0);const rows=[];
  for(const {key,child}of people){if(existing.get(key)&&existing.get(key).status!=='cancelled')throw Error('already-registered');if(participants&&participants.contains({registrationId:key,uid:key,familyPlayerId:child?.id}))throw Error('already-registered');let status;if(quick?(quick.capacity===null||occupied<quick.capacity):confirmed<Number(t.capacity)){status='confirmed';confirmed++;occupied++;}else if(t.waitlistEnabled&&waitlist<Number(t.waitlistCapacity)){status='waitlist';waitlist++;}else throw Error('full');const realName=child?child.name:u.realName,gameId=child?child.nickname:u.gameId||u.nickname||'',nameMode=pub.participantNameMode==='gameId'?'gameId':'realName';rows.push({registrationId:key,childId:child?.id||null,displayCode:child?.displayCode||u.playerId||'',participantName:nameMode==='gameId'?(gameId||realName):realName,status,realName,gameId,nameMode});}
  const allocation=rows.map(x=>({registrationId:x.registrationId,status:x.status}));
  if(d.action==='preview')return {ok:true,rows,allocation};
  if(Array.isArray(d.allocation)&&JSON.stringify(d.allocation)!==JSON.stringify(allocation))throw Error('allocation-changed');
  // Build the complete post-transaction registration view before writing. The
  // roster, counters and registration documents commit under the same lock.
  const registrations=rows.map((row,i)=>{const child=people[i].child;const reg={uid:row.registrationId,tournamentCode:code,realName:row.realName,gameId:row.gameId,displayName:row.participantName,publicName:row.participantName,nameMode:row.nameMode,phone:u.phone||'',email:u.email||null,status:row.status,source:'player',displayCode:row.displayCode,childEligibilityConfirmed:true,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),cancelledAt:null,cancelledBy:null,promotedAt:null,promotedBy:null,registrationVersion:2};if(child)Object.assign(reg,{familyPlayerId:child.id,participantId:child.id,guardianUid:uid,displayCode:child.displayCode||child.playerId,participantSnapshot:{playerId:child.playerId,name:child.name,nickname:child.nickname},familyRegistrationVersion:2,ladderEligible:false,activityEligible:false});return reg;});
  let projection=null;
  if(quick){
   const next=new Map(quickRows.map(row=>[row.registrationId,row]));
   if(migrating){next.delete(uid);const key=childKey(migrating.familyPlayerId);next.set(key,{...migrating,registrationId:key,uid:key,guardianUid:uid});}
   registrations.forEach((reg,i)=>next.set(rows[i].registrationId,{...reg,registrationId:rows[i].registrationId,createdAt:now}));
   projection=project([...next.values()]);
  }
  if(migrating){const key=childKey(migrating.familyPlayerId);tx.set(tr.collection('registrations').doc(key),{...migrating,uid:key,guardianUid:uid,registrationVersion:2});tx.delete(legacyRef);tx.set(fr.collection('registrations').doc(code+'_'+migrating.familyPlayerId),{code,childId:migrating.familyPlayerId,createdAt:ms(migrating.createdAt)});tx.delete(fr.collection('registrations').doc(code));}
  registrations.forEach((reg,i)=>{const child=people[i].child;tx.set(tr.collection('registrations').doc(rows[i].registrationId),reg);if(child)tx.set(fr.collection('registrations').doc(code+'_'+child.id),{childId:child.id,code,createdAt:now});});
  tx.update(tr,{confirmedCount:confirmed,waitlistCount:waitlist,updatedAt:now,...projection?.private});tx.update(pr,{confirmedCount:confirmed,waitlistCount:waitlist,updatedAt:now,...projection?.public});
  // Migration can delete the old guardian slot, then this join can replace it
  // with self. Later requested writes take precedence by ID in the proof.
  const proofFields=myEventsProofEnabled===true?operationFields(uid,code,'join',ts.createTime,[...(migrating?[{id:uid,mode:'delete'},{id:childKey(migrating.familyPlayerId),mode:'write'}]:[]),...rows.map(row=>({id:row.registrationId,mode:'write'}))],now):{};
  const result={ok:true,rows,status:rows[0].status};tx.create(ar,{action:'join',code,actorUid:uid,requestHash,result,createdAt:now,...proofFields});return result;
 },d.action==='preview'?{readOnly:true}:undefined);
};return req=>{
 const d=req.data||{},code=String(d.code||'').toUpperCase();
 if(!req.auth?.uid||!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!['join','cancel','syncSummary'].includes(d.action)||!/^[a-zA-Z0-9_-]{8,100}$/.test(d.operationId||''))return handle(req);
 return admit(code,()=>handle(req),{key:JSON.stringify([req.auth.uid,d.operationId]),fingerprint:hash(JSON.stringify(d))});
};}
module.exports={createFamilyRegistration};
