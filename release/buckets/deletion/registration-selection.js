'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {getFirestore,FieldValue,FieldPath}=require("./_qr_checkin/admin-firestore.cjs");
const {randomInt,randomUUID}=require('node:crypto');
const C=require('./operations-core');
const {assertLegacyRosterWritable:assertOnsiteRosterWritable}=require('./onsite-waitlist-writer-guards');
const {createDeletionService}=require('./tournament-delete');
function assertLegacyRosterWritable(t,p){
 if([t,p].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))throw Error('bucket-scoring-required');
 assertOnsiteRosterWritable(t,p,C.parseState(t));
}
const deletion=createDeletionService({
 allowOrphanCleanup:false,validOperation:/^[A-Za-z0-9_-]{1,100}$/,
 normalize:code=>{if(typeof code!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(code))throw Error('invalid-request');return code;},
 authorize:(actor,uid,t,now,p)=>{
  if(!C.canManage(actor,uid,t,now))return false;
  if(!t.registrationSelection)throw Error('lottery-not-enabled');
  if(t.registrationSelection.status==='drawing')throw Error('draw-processing');
  assertOnsiteRosterWritable(t,p,C.parseState(t));return true;
 }
});
const db=getFirestore();
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const ms=v=>v?.toMillis?v.toMillis():Number(v)||0;
const publicMode=m=>({status:m.status,capacity:m.capacity,version:2});
const timeOrder=(a,b)=>ms(a.createdAt)-ms(b.createdAt)||a.uid.localeCompare(b.uid);
function selectCandidates(records,capacity,rand=randomInt){
 const pool=records.filter(r=>r.status!=='cancelled').sort(timeOrder),chosen=pool.slice();
 for(let i=0;i<Math.min(capacity,chosen.length);i++){const j=rand(i,chosen.length);[chosen[i],chosen[j]]=[chosen[j],chosen[i]];}
 const selected=chosen.slice(0,capacity),ids=new Set(selected.map(r=>r.uid));return {selected,waiting:pool.filter(r=>!ids.has(r.uid))};
}
function unlocked(t){const s=C.parseState(t);if(t.systemClosed||s.startedAt||s.bracketSize||s.matches.length||s.meta.eventCancelled||['live','settling','done','cancelled'].includes(t.tournamentPhase)||s.archiveStatus==='completed')throw Error('entry-selection-locked');return s;}
async function manager(tx,uid,code){const [p,t,pub]=await Promise.all([tx.get(db.doc(`users/${uid}`)),tx.get(db.doc(`tournaments/${code}`)),tx.get(db.doc(`publicTournaments/${code}`))]);if(!t.exists||!p.exists||!C.canManage(p.data(),uid,t.data(),Date.now()))throw Error('tournament-access-denied');assertLegacyRosterWritable(t.data(),pub.data());return t.data();}
function projection(r){return {uid:r.uid,key:r.uid,playerId:'online_'+r.uid,name:r.displayName||r.publicName||r.realName||r.uid};}
async function allRegistrations(code){let last;const out=[];do{let q=db.collection(`tournaments/${code}/registrations`).orderBy(FieldPath.documentId()).limit(250);if(last)q=q.startAfter(last);const snap=await q.get();out.push(...snap.docs.map(d=>({...d.data(),uid:d.id})));last=snap.size===250?snap.docs.at(-1):null;}while(last);return out;}
// Registration count is not capped. Each signup is one serialized transaction.
exports.lotteryRegistration=onCall({region:'asia-east1',cors:true},async req=>{
 const uid=req.auth?.uid,d=req.data||{},code=d.code;if(!uid)throw new HttpsError('unauthenticated','auth-required');
 if(!valid(code)||!['join','cancel'].includes(d.action))throw new HttpsError('invalid-argument','invalid-request');
 try{return await db.runTransaction(async tx=>{
  const tr=db.doc(`tournaments/${code}`),pr=db.doc(`publicTournaments/${code}`),rr=db.doc(`tournaments/${code}/registrations/${uid}`);
  const [ts,ps,rs,us]=await Promise.all([tx.get(tr),tx.get(pr),tx.get(rr),tx.get(db.doc(`users/${uid}`))]);
  if(!ts.exists||!ps.exists||!us.exists||us.data().active!==true)throw Error('inactive-account');
  const t=ts.data(),p=ps.data(),u=us.data(),mode=t.registrationSelection,now=Date.now();
  assertLegacyRosterWritable(t,p);
  if(!mode)throw Error('lottery-not-enabled');unlocked(t);
  if(mode.status==='drawing')throw Error('draw-processing');
  if(d.action==='join'){
   if(mode.status!=='open'||!p.registrationEnabled||p.registrationVisibility!=='public'||now<ms(p.registrationOpenAt)||now>=ms(p.registrationCloseAt))throw Error('registration-not-open');
   if(!u.realName||typeof u.phone!=='string'||u.profileCompleted!==true)throw Error('profile-incomplete');
   if(p.targetGroup==='children'&&d.childEligibilityConfirmed!==true)throw Error('child-eligibility-required');
   if(rs.exists&&rs.data().status!=='cancelled')return {ok:true,status:rs.data().status};
   const displayName=p.participantNameMode==='gameId'?(u.gameId||u.nickname||u.realName):u.realName;
   tx.set(rr,{uid,tournamentCode:code,realName:u.realName,gameId:u.gameId||'',displayName,publicName:displayName,nameMode:p.participantNameMode||'realName',phone:u.phone||'',email:u.email||null,status:'pending_draw',source:'player',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),childEligibilityConfirmed:d.childEligibilityConfirmed===true,cancelledAt:null,cancelledBy:null,promotedAt:null,promotedBy:null});
   tx.update(tr,{registeredCount:FieldValue.increment(1)});tx.update(pr,{registeredCount:FieldValue.increment(1)});
   return {ok:true,status:'pending_draw'};
  }
  if(!rs.exists||rs.data().status==='cancelled')return {ok:true,status:'cancelled'};
  if(p.cancellationDeadline&&now>=ms(p.cancellationDeadline))throw Error('cancellation-deadline');
  const old=rs.data();tx.update(rr,{status:'cancelled',cancelledAt:FieldValue.serverTimestamp(),cancelledBy:uid,updatedAt:FieldValue.serverTimestamp()});
  const changes={registeredCount:FieldValue.increment(-1)};
  if(mode.status==='drawn'&&old.status==='confirmed'){
   changes.confirmedCount=FieldValue.increment(-1);
   const s=C.parseState(t),revision=Number(t.entrySelectionRevision||0)+1;s.entrySelection.vacancies=Number(s.entrySelection.vacancies||0)+1;s.entrySelectionRevision=revision;s.updatedAt=now;
   tx.update(tr,{data:JSON.stringify(s),entrySelectionRevision:revision,entrySelectionWriteRevision:revision});
  }
  if(mode.status==='drawn'&&old.status==='waitlist'){
   changes.waitlistCount=FieldValue.increment(-1);const s=C.parseState(t),revision=Number(t.entrySelectionRevision||0)+1;s.entrySelection.waitingCount=Math.max(0,Number(s.entrySelection.waitingCount||0)-1);s.entrySelectionRevision=revision;s.updatedAt=now;tx.update(tr,{data:JSON.stringify(s),entrySelectionRevision:revision,entrySelectionWriteRevision:revision});
  }
  tx.update(tr,changes);tx.update(pr,changes);return {ok:true,status:'cancelled'};
 });}catch(e){throw new HttpsError('failed-precondition',e.message);}
});
async function configure(uid,d){return db.runTransaction(async tx=>{
 const t=await manager(tx,uid,d.code),s=unlocked(t),mode=t.registrationSelection;
 if(mode&&mode.status!=='open')throw Error('already-selected');
 if(t.entrySelectionRevision&&!mode)throw Error('legacy-selection-already-configured');
 if(!Number.isInteger(d.capacity)||d.capacity<2||d.capacity>512)throw Error('invalid-entry-capacity');
 const p=await tx.get(db.doc(`publicTournaments/${d.code}`));if(!p.exists)throw Error('publish-event-first');
 if(t.eventAuthority==='community'||p.data().registrationEnabled!==true)throw Error('online-registration-required');
 const regs=await tx.get(db.collection(`tournaments/${d.code}/registrations`));
 // Existing registrations stay eligible; their original server timestamps determine reserve order.
 const count=regs.docs.filter(x=>x.data().status!=='cancelled').length;
 const config={status:'open',capacity:d.capacity,version:2};
 const revision=Number(t.entrySelectionRevision||0)+1;
 s.entrySelection={status:'configured',capacity:d.capacity,selected:[],waiting:[],mode:'registration'};s.entrySelectionRevision=revision;s.updatedAt=Date.now();
 tx.update(db.doc(`tournaments/${d.code}`),{registrationSelection:config,registeredCount:count,capacity:null,entrySelectionRevision:revision,entrySelectionWriteRevision:revision,data:JSON.stringify(s)});
 tx.update(db.doc(`publicTournaments/${d.code}`),{registrationSelection:config,registeredCount:count,capacity:null});
 return {ok:true,state:s};
});}
async function preview(uid,d){await db.runTransaction(tx=>manager(tx,uid,d.code));const t=(await db.doc(`tournaments/${d.code}`).get()).data();unlocked(t);if(!['open','drawing'].includes(t.registrationSelection?.status))throw Error('configure-entry-first');const records=(await allRegistrations(d.code)).filter(r=>r.status!=='cancelled').sort(timeOrder);return {ok:true,resuming:t.registrationSelection.status==='drawing',count:records.length,candidates:records.slice(0,100).map(projection),candidateHash:C.poolHash(records.map(r=>({uid:r.uid,at:ms(r.createdAt)}))),truncated:records.length>100};}
async function draw(uid,d){
 const tr=db.doc(`tournaments/${d.code}`),pr=db.doc(`publicTournaments/${d.code}`),runRef=db.doc(`tournaments/${d.code}/registrationDraw/current`);
 // Freeze both registration writes and runtime edits before reading the full pool.
 await db.runTransaction(async tx=>{const t=await manager(tx,uid,d.code);unlocked(t);const mode=t.registrationSelection;if(!mode)throw Error('configure-entry-first');if(mode.status==='drawn')return;if(mode.status==='drawing'){d.operationId=mode.operationId;return;}if(mode.status!=='open')throw Error('configure-entry-first');const next={...mode,status:'drawing',operationId:d.operationId,actorUid:uid};tx.update(tr,{registrationSelection:next});tx.update(pr,{registrationSelection:publicMode(next)});});
 let t=(await tr.get()).data();if(t.registrationSelection.status==='drawn')return {ok:true,state:C.parseState(t),replayed:true};
 let plan=(await runRef.get()).data();
 if(!plan){
  const records=(await allRegistrations(d.code)).filter(r=>r.status!=='cancelled').sort(timeOrder);
  const hash=C.poolHash(records.map(r=>({uid:r.uid,at:ms(r.createdAt)})));
  if(hash!==d.candidateHash||records.length<2){await db.runTransaction(async tx=>{const fresh=await tx.get(tr),pub=await tx.get(pr);assertLegacyRosterWritable(fresh.data(),pub.data());if(fresh.data().registrationSelection.operationId===d.operationId){const config={status:'open',capacity:t.registrationSelection.capacity,version:2};tx.update(tr,{registrationSelection:config});tx.update(pr,{registrationSelection:publicMode(config)});}});throw Error(records.length<2?'not-enough-registrations':'candidate-list-changed');}
  const result=selectCandidates(records,t.registrationSelection.capacity);
  const candidatePlan={selected:result.selected.map(projection),candidateHash:hash,total:records.length,actorUid:uid,operationId:d.operationId};
  // create is an atomic winner: simultaneous retries reuse the same persisted draw.
  try{await db.runTransaction(async tx=>{const [fresh,pub]=await Promise.all([tx.get(tr),tx.get(pr)]);assertLegacyRosterWritable(fresh.data(),pub.data());if(fresh.data().registrationSelection?.status!=='drawing'||fresh.data().registrationSelection.operationId!==d.operationId)throw Error('draw-processing');tx.create(runRef,candidatePlan);});plan=candidatePlan;}catch(e){if(e.code!==6&&e.code!=='already-exists')throw e;plan=(await runRef.get()).data();}
 }
 const ids=new Set(plan.selected.map(p=>p.uid));const records=(await allRegistrations(d.code)).filter(r=>r.status!=='cancelled').sort(timeOrder);
 let rank=0;
 const updates=records.map(r=>({uid:r.uid,patch:{status:ids.has(r.uid)?'confirmed':'waitlist',waitRank:ids.has(r.uid)?null:++rank,drawOperationId:plan.operationId,updatedAt:FieldValue.serverTimestamp()}}));
 // Every chunk reads the current ownership marker under the same write lock.
 for(let start=0;start<updates.length;start+=400){const chunk=updates.slice(start,start+400);await db.runTransaction(async tx=>{const [fresh,pub]=await Promise.all([tx.get(tr),tx.get(pr)]);assertLegacyRosterWritable(fresh.data(),pub.data());if(fresh.data().registrationSelection?.status!=='drawing'||fresh.data().registrationSelection.operationId!==d.operationId)throw Error('draw-processing');for(const row of chunk)tx.update(db.doc(`tournaments/${d.code}/registrations/${row.uid}`),row.patch);});}
 return db.runTransaction(async tx=>{
  const fresh=await tx.get(tr),pub=await tx.get(pr);t=fresh.data();assertLegacyRosterWritable(t,pub.data());if(t.registrationSelection.status==='drawn')return {ok:true,state:C.parseState(t),replayed:true};
  const s=C.parseState(t),revision=Number(t.entrySelectionRevision||0)+1;
  s.players=plan.selected.map(p=>({id:p.playerId,name:p.name,uid:p.uid,playerUid:p.uid,registrationUid:p.uid,source:'online',checkedIn:false}));
  s.entrySelection={status:'drawn',mode:'registration',capacity:t.registrationSelection.capacity,selected:plan.selected,waiting:[],waitingCount:rank};s.entrySelectionRevision=revision;s.updatedAt=Date.now();
  const config={...t.registrationSelection,status:'drawn'};
  tx.update(tr,{registrationSelection:config,data:JSON.stringify(s),entrySelectionRevision:revision,entrySelectionWriteRevision:revision,confirmedCount:plan.selected.length,waitlistCount:rank});
  let view=JSON.parse(pub.data().bracketView||'{}');view.players=s.players.map(p=>({id:p.id,name:p.name,checkedIn:false}));
  tx.update(pr,{registrationSelection:publicMode(config),confirmedCount:plan.selected.length,waitlistCount:rank,bracketView:JSON.stringify(view)});
  return {ok:true,state:s};
 });
}
async function promote(uid,d){return db.runTransaction(async tx=>{
 const t=await manager(tx,uid,d.code),s=unlocked(t);if(t.registrationSelection?.status!=='drawn')throw Error('draw-entry-first');
 const op=db.doc(`tournaments/${d.code}/entryOperations/${d.operationId}`),prior=await tx.get(op);if(prior.exists){if(prior.data().actorUid!==uid||prior.data().requestHash!==C.poolHash(d))throw Error('operation-conflict');return {ok:true,state:s,replayed:true};}
 if(typeof d.reason!=='string'||d.reason.trim().length<2||d.reason.length>300)throw Error('replacement-reason-required');
 const removed=s.entrySelection.selected.find(p=>p.key===d.removeKey);if(!removed)throw Error('selected-player-not-found');
 // Read in server timestamp order; avoids a compound index and skips cancelled reserves.
 const regs=await tx.get(db.collection(`tournaments/${d.code}/registrations`));const waiting=regs.docs.map(x=>({...x.data(),uid:x.id})).filter(r=>r.status==='waitlist').sort(timeOrder);
 const next=waiting.length?projection(waiting[0]):null,rr=db.doc(`tournaments/${d.code}/registrations/${removed.uid}`),removedSnap=await tx.get(rr),pub=await tx.get(db.doc(`publicTournaments/${d.code}`));
 s.entrySelection.vacancies=Math.max(0,Number(s.entrySelection.vacancies||0)-(removedSnap.data()?.status==='cancelled'?1:0));
 s.entrySelection.selected=next?s.entrySelection.selected.map(p=>p.uid===removed.uid?next:p):s.entrySelection.selected.filter(p=>p.uid!==removed.uid);s.entrySelection.waitingCount=Math.max(0,waiting.length-1);
 s.players=s.players.filter(p=>p.id!==removed.playerId);if(next)s.players.push({id:next.playerId,name:next.name,uid:next.uid,playerUid:next.uid,registrationUid:next.uid,source:'online',checkedIn:false});
 const revision=Number(t.entrySelectionRevision||0)+1;s.entrySelectionRevision=revision;s.updatedAt=Date.now();
 const changes={confirmedCount:FieldValue.increment((next?1:0)-(removedSnap.data()?.status==='confirmed'?1:0)),waitlistCount:FieldValue.increment(next?-1:0)};
 if(removedSnap.data()?.status!=='cancelled')changes.registeredCount=FieldValue.increment(-1);
 tx.update(rr,{status:'cancelled',cancelledBy:uid,cancelledAt:FieldValue.serverTimestamp()});if(next)tx.update(db.doc(`tournaments/${d.code}/registrations/${next.uid}`),{status:'confirmed',promotedAt:FieldValue.serverTimestamp(),promotedBy:uid,waitRank:null});
 tx.update(db.doc(`tournaments/${d.code}`),{...changes,data:JSON.stringify(s),entrySelectionRevision:revision,entrySelectionWriteRevision:revision});
 const view=JSON.parse(pub.data().bracketView||'{}');view.players=s.players.map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn===true}));tx.update(pub.ref,{...changes,bracketView:JSON.stringify(view)});
 tx.create(op,{actorUid:uid,requestHash:C.poolHash(d),removed,promoted:next,reason:d.reason.trim(),createdAt:FieldValue.serverTimestamp()});return {ok:true,state:s};
});}
async function deleteEvent(uid,d){return deletion.execute({auth:{uid},data:{code:d.code,operationId:d.operationId}});}

exports.manageRegistrationSelection=onCall({region:'asia-east1',cors:true,timeoutSeconds:540},async req=>{
 const uid=req.auth?.uid,d=req.data||{};if(!uid)throw new HttpsError('unauthenticated','auth-required');if(!valid(d.code)||!valid(d.operationId)||!['configure','preview','draw','promote','delete'].includes(d.action))throw new HttpsError('invalid-argument','invalid-request');
 const lease=db.doc(`tournaments/${d.code}/registrationDrawLease/current`),token=randomUUID();let held=false;
 try{
  if(d.action==='draw')await db.runTransaction(async tx=>{await manager(tx,uid,d.code);const l=await tx.get(lease);if(l.exists&&l.data().until>Date.now())throw Error('draw-processing');tx.set(lease,{token,until:Date.now()+600000});held=true;});
  return await ({configure,preview,draw,promote,delete:deleteEvent}[d.action])(uid,d);
 }catch(e){throw new HttpsError(e.message==='draw-processing'?'unavailable':'failed-precondition',e.message);}
 finally{if(held)await db.runTransaction(async tx=>{const [l,t,p]=await Promise.all([tx.get(lease),tx.get(db.doc(`tournaments/${d.code}`)),tx.get(db.doc(`publicTournaments/${d.code}`))]);if(!t.exists||[t.data(),p.data()].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))return;if(l.data()?.token===token)tx.delete(lease);});}
});
