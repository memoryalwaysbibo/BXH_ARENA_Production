'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {getFirestore,FieldPath}=require('firebase-admin/firestore');
const {randomUUID}=require('node:crypto');
const C=require('./operations-core');
const {backgroundJobsEnabled}=require('./release-controls');
const db=getFirestore(),region='asia-east1',configRef=db.doc('systemSettings/tournamentOperations');
function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw new HttpsError('invalid-argument','invalid-id');return v;}
function err(e){if(e instanceof HttpsError)throw e;throw new HttpsError('failed-precondition',String(e.message||'operation-failed'));}
async function actor(request){if(!request.auth)throw new HttpsError('unauthenticated','auth-required');const ref=db.doc(`users/${request.auth.uid}`),snap=await ref.get();if(!snap.exists||snap.data().active!==true)throw new HttpsError('permission-denied','inactive-account');return {uid:request.auth.uid,ref,data:snap.data()};}
function requireSuper(a){if(a.data.role!=='super_admin'||a.data.isTestAccount===true)throw new HttpsError('permission-denied','super-admin-required');}
function ensureManager(a,t){if(!C.canManage(a.data,a.uid,t,Date.now()))throw new HttpsError('permission-denied','tournament-access-denied');}
function auditRef(code){return db.doc(`tournaments/${code}/operationLog/${randomUUID()}`);}
async function updateActivity(code,at){const ref=db.doc(`tournamentActivity/${code}`);await db.runTransaction(async tx=>{const snap=await tx.get(ref),d=snap.exists?snap.data():{};if(at>C.ms(d.lastAt))tx.set(ref,{lastAt:at},{merge:true});});}
exports.trackTournamentActivity=onDocumentWritten({document:'tournaments/{code}',region},async event=>{
 const after=event.data&&event.data.after,before=event.data&&event.data.before;if(!after||!after.exists)return;
 try{const a=after.data();if(a.systemClosed===true)return;if(before.exists&&C.fingerprint(before.data())===C.fingerprint(a))return;await updateActivity(event.params.code,after.updateTime.toMillis());}catch(e){console.warn('activity-data-skipped',event.params.code,e.message);}
});
exports.trackTournamentRegistrationActivity=onDocumentWritten({document:'tournaments/{code}/registrations/{uid}',region},async event=>{
 const a=event.data?.after,b=event.data?.before;if(!a)return;
 if(a.exists&&b?.exists&&JSON.stringify(a.data())===JSON.stringify(b.data()))return;
 const at=a.exists?a.updateTime.toMillis():event.time?Date.parse(event.time):0;
 if(at>0)await updateActivity(event.params.code,at);
});
exports.setTournamentOperations=onCall({region,cors:true,invoker:'public'},async request=>{
 const a=await actor(request);requireSuper(a);if(typeof request.data?.enabled!=='boolean')throw new HttpsError('invalid-argument','enabled-required');
 return db.runTransaction(async tx=>{const [u,s]=await Promise.all([tx.get(a.ref),tx.get(configRef)]);requireSuper({data:u.data()||{}});if(u.data()?.active!==true)throw new HttpsError('permission-denied','inactive-account');const old=s.exists?s.data():{},now=Date.now();tx.set(configRef,{enabled:request.data.enabled,enabledAt:request.data.enabled&&old.enabled!==true?now:C.ms(old.enabledAt),updatedAt:now,updatedBy:a.uid},{merge:true});return {ok:true,enabled:request.data.enabled};});
});
async function checkAndClose(code){
 const ref=db.doc(`tournaments/${code}`),pub=db.doc(`publicTournaments/${code}`),activity=db.doc(`tournamentActivity/${code}`),log=auditRef(code);
 return db.runTransaction(async tx=>{
  const [t,p,a,c]=await Promise.all([tx.get(ref),tx.get(pub),tx.get(activity),tx.get(configRef)]);
  if(!t.exists||!c.exists||c.data().enabled!==true)return;
  const d=t.data(),tracker=a.exists?a.data():{},now=Date.now(),hash=C.fingerprint(d);
  // Poll fallback covers missing/delayed triggers; first observation always grants 24h.
  if(!tracker.observedAt||tracker.fingerprint!==hash){tx.set(activity,{observedAt:tracker.observedAt||now,lastAt:Math.max(C.ms(tracker.lastAt),now),fingerprint:hash},{merge:true});return;}
  const decision=C.idleDecision(d,tracker,c.data(),now);if(!decision)return;
  const s=decision.s,info={reason:'idle-24h',label:'比賽結束（系統關閉）',closedAt:now,lastActivityAt:decision.lastAt};
  const previous={archiveStatus:s.archiveStatus||'ongoing',completedAt:s.completedAt||null,archivedAt:s.archivedAt||null,metaRegistrationStatus:s.meta.registrationStatus||null,topPhase:d.tournamentPhase||'waiting',topRegistrationStatus:d.registrationStatus||null,publicRegistrationStatus:p.exists?p.data().registrationStatus||null:null};
  s.systemClosure=info;s.archiveStatus='completed';s.completedAt=now;s.archivedAt=now;s.meta.registrationStatus='closed';
  const update={systemClosed:true,systemClosure:info,archiveStatus:'completed',tournamentPhase:'done',registrationStatus:'closed',data:JSON.stringify(s),updatedAt:now};
  let publicUpdate=null;if(p.exists){let mirror;try{mirror=JSON.parse(p.data().bracketView);}catch(e){throw Error('invalid-public-mirror');}Object.assign(mirror,{systemClosure:info,archiveStatus:'completed',completedAt:now,archivedAt:now});if(mirror.meta)mirror.meta.registrationStatus='closed';publicUpdate={systemClosed:true,systemClosure:info,archiveStatus:'completed',tournamentPhase:'done',registrationStatus:'closed',bracketView:JSON.stringify(mirror),updatedAt:now};}
  tx.update(ref,update);if(publicUpdate)tx.update(pub,publicUpdate);
  tx.set(activity,{previous,closedAt:now},{merge:true});tx.create(log,{type:'system-close',at:now,actor:'system',...info});
 });
}
exports.closeIdleTournaments=onSchedule({region,schedule:'every 5 minutes',timeZone:'Asia/Taipei',timeoutSeconds:300,maxInstances:1},async()=>{
 if(!(await backgroundJobsEnabled()))return;
 const settings=await configRef.get();if(!settings.exists||settings.data().enabled!==true)return;
 const cursor=settings.data().scanCursor||'';let q=db.collection('tournaments').orderBy(FieldPath.documentId()).limit(100);if(cursor)q=q.startAfter(cursor);
 const snap=await q.get();for(const doc of snap.docs){try{await checkAndClose(doc.id);}catch(e){console.error('idle-close-failed',doc.id,e.message);}}
 await configRef.set({scanCursor:snap.size===100?snap.docs.at(-1).id:'',lastScanAt:Date.now()},{merge:true});
});
exports.restoreIdleTournament=onCall({region,cors:true,invoker:'public'},async request=>{
 const a=await actor(request);requireSuper(a);const code=id(request.data?.code).toUpperCase(),reason=C.cleanText(request.data?.reason,300);if(reason.length<2)throw new HttpsError('invalid-argument','reason-required');
 const ref=db.doc(`tournaments/${code}`),pub=db.doc(`publicTournaments/${code}`),activity=db.doc(`tournamentActivity/${code}`),log=auditRef(code);
 try{return await db.runTransaction(async tx=>{
  const [u,t,p,h]=await Promise.all([tx.get(a.ref),tx.get(ref),tx.get(pub),tx.get(activity)]);requireSuper({data:u.data()||{}});if(u.data()?.active!==true)throw new HttpsError('permission-denied','inactive-account');
  if(!t.exists||t.data().systemClosed!==true)throw Error('not-system-closed');const prev=h.data()?.previous;if(!prev)throw Error('restore-snapshot-missing');
  const now=Date.now(),s=C.parseState(t.data());s.archiveStatus=prev.archiveStatus;s.completedAt=prev.completedAt;s.archivedAt=prev.archivedAt;s.meta.registrationStatus=prev.metaRegistrationStatus;s.systemClosure={...t.data().systemClosure,restoredAt:now,restoredBy:a.uid,restoreReason:reason};
  let patch;if(p.exists){const m=JSON.parse(p.data().bracketView),publicClosure={reason:'idle-24h',label:s.systemClosure.label,closedAt:s.systemClosure.closedAt,lastActivityAt:s.systemClosure.lastActivityAt,restoredAt:now};Object.assign(m,{archiveStatus:s.archiveStatus,completedAt:s.completedAt,archivedAt:s.archivedAt,systemClosure:publicClosure});if(m.meta)m.meta.registrationStatus=prev.metaRegistrationStatus;patch={systemClosed:false,systemClosure:publicClosure,archiveStatus:s.archiveStatus,tournamentPhase:prev.topPhase,registrationStatus:prev.publicRegistrationStatus,bracketView:JSON.stringify(m),updatedAt:now};}
  tx.update(ref,{systemClosed:false,systemClosure:s.systemClosure,archiveStatus:s.archiveStatus,tournamentPhase:prev.topPhase,registrationStatus:prev.topRegistrationStatus,data:JSON.stringify(s),updatedAt:now});if(patch)tx.update(pub,patch);tx.set(activity,{restoredAt:now,lastAt:now,fingerprint:C.fingerprint({...t.data(),data:JSON.stringify(s)})},{merge:true});tx.create(log,{type:'restore',at:now,actor:a.uid,reason,closedAt:t.data().systemClosure.closedAt});return {ok:true};
 });}catch(e){err(e);}
});
exports.getTournamentOperations=onCall({region,cors:true,invoker:'public'},async request=>{
 const a=await actor(request),code=id(request.data?.code).toUpperCase(),t=await db.doc(`tournaments/${code}`).get();if(!t.exists)throw new HttpsError('not-found','tournament-not-found');ensureManager(a,t.data());
 const [config,raffles,logs]=await Promise.all([configRef.get(),db.collection(`tournaments/${code}/raffles`).orderBy('createdAt','desc').limit(50).get(),db.collection(`tournaments/${code}/operationLog`).orderBy('at','desc').limit(30).get()]);
 return {ok:true,version:'13.29.9',enabled:config.exists&&config.data().enabled===true,systemClosed:t.data().systemClosed===true,closure:t.data().systemClosure||null,raffles:raffles.docs.map(x=>({id:x.id,...x.data()})),logs:logs.docs.map(x=>({id:x.id,...x.data()}))};
});
exports.previewTournamentRaffle=onCall({region,cors:true,invoker:'public'},async request=>{
 const a=await actor(request),code=id(request.data?.code).toUpperCase(),t=await db.doc(`tournaments/${code}`).get();if(!t.exists)throw new HttpsError('not-found','tournament-not-found');ensureManager(a,t.data());if(t.data().systemClosed)throw new HttpsError('failed-precondition','system-closed');
 try{const ledger=await db.doc(`tournaments/${code}/raffleControl/current`).get(),exclude=request.data.excludePrevious!==false?(ledger.data()?.winnerKeys||[]):[],pool=C.candidates(C.parseState(t.data()),request.data.mode,exclude);if(pool.length>1000)throw Error('candidate-limit-1000');return {ok:true,count:pool.length,candidates:pool,candidateHash:C.poolHash(pool)};}catch(e){err(e);}
});
exports.drawTournamentRaffle=onCall({region,cors:true,invoker:'public'},async request=>{
 const a=await actor(request),code=id(request.data?.code).toUpperCase(),op=id(request.data?.operationId),mode=request.data?.mode,excludePrevious=request.data?.excludePrevious!==false;
 let normalized;try{normalized=C.normalizePrizes(request.data?.prizes,{title:request.data?.title,description:request.data?.description,count:request.data?.count});}catch(e){err(e);}
 const prizes=normalized.prizes,count=normalized.totalCount,title=prizes.length===1?prizes[0].name:`多品項抽獎（${prizes.length} 項）`,description=prizes.length===1?prizes[0].description:'';
 const ref=db.doc(`tournaments/${code}`),raffle=db.doc(`tournaments/${code}/raffles/${op}`),control=db.doc(`tournaments/${code}/raffleControl/current`),activity=db.doc(`tournamentActivity/${code}`),log=auditRef(code);
 try{return await db.runTransaction(async tx=>{
  const [u,t,r,l]=await Promise.all([tx.get(a.ref),tx.get(ref),tx.get(raffle),tx.get(control)]);if(!t.exists)throw Error('tournament-not-found');ensureManager({...a,data:u.data()||{}},t.data());
  if(r.exists){
   const old=r.data(),oldNormalized=C.normalizePrizes(old.prizes,{title:old.title,description:old.description,count:old.count});
   if(old.createdBy!==a.uid||old.mode!==mode||old.excludePrevious!==excludePrevious||JSON.stringify(oldNormalized.prizes)!==JSON.stringify(prizes))throw Error('operation-conflict');
   return {ok:true,id:op,...old,replayed:true};
  }
  if(t.data().systemClosed)throw Error('system-closed');const s=C.parseState(t.data()),ledger=l.data()||{},prior=ledger.winnerKeys||[],pool=C.candidates(s,mode,excludePrevious?prior:[]);if(pool.length>1000)throw Error('candidate-limit-1000');
  if(request.data.candidateHash!==C.poolHash(pool))throw Error('candidate-list-changed');
  const selected=C.draw(pool,count),winners=C.assignPrizeWinners(selected,prizes),now=Date.now(),record={title,description,prizes,mode,count,excludePrevious,candidates:pool,winners,createdAt:now,createdBy:a.uid,testMode:t.data().testMode===true,revision:0};
  const keys=[...new Set([...prior,...winners.map(w=>w.key)])];if(keys.length>2000)throw Error('winner-ledger-limit');
  tx.create(raffle,record);tx.set(control,{winnerKeys:keys},{merge:true});tx.set(activity,{lastAt:now},{merge:true});tx.create(log,{type:'raffle-draw',at:now,actor:a.uid,raffleId:op,title,count,prizeCount:prizes.length});return {ok:true,id:op,...record};
 });}catch(e){err(e);}
});
exports.updateTournamentRaffleWinner=onCall({region,cors:true,invoker:'public'},async request=>{
 const a=await actor(request),d=request.data||{},code=id(d.code).toUpperCase(),rid=id(d.raffleId),op=id(d.operationId),reason=C.cleanText(d.reason,300);
 if(!['claim','forfeit','replace'].includes(d.action))throw new HttpsError('invalid-argument','invalid-action');if(d.action!=='claim'&&reason.length<2)throw new HttpsError('invalid-argument','reason-required');
 const ref=db.doc(`tournaments/${code}`),raffle=db.doc(`tournaments/${code}/raffles/${rid}`),control=db.doc(`tournaments/${code}/raffleControl/current`),operation=db.doc(`tournaments/${code}/operationLog/${op}`),activity=db.doc(`tournamentActivity/${code}`);
 try{return await db.runTransaction(async tx=>{
  const [u,t,r,l,o]=await Promise.all([tx.get(a.ref),tx.get(ref),tx.get(raffle),tx.get(control),tx.get(operation)]);if(!t.exists)throw Error('tournament-not-found');ensureManager({...a,data:u.data()||{}},t.data());
  if(o.exists){if(o.data().actor!==a.uid||o.data().raffleId!==rid||o.data().winnerKey!==d.winnerKey||o.data().action!==d.action)throw Error('operation-conflict');return {ok:true,replayed:true};}
  if(t.data().systemClosed)throw Error('system-closed');if(!r.exists)throw Error('raffle-not-found');const data=r.data(),winners=data.winners.slice(),i=winners.findIndex(w=>w.key===d.winnerKey);if(i<0)throw Error('winner-not-found');const now=Date.now();
  if(d.action==='replace'){
   if(winners[i].status!=='forfeited')throw Error('forfeit-first');const all=l.data()?.winnerKeys||[],pool=data.candidates.filter(p=>!all.includes(p.key)&&!winners.some(w=>w.key===p.key)),replacement=C.draw(pool,1)[0];
   if(new Set([...all,replacement.key]).size>2000)throw Error('winner-ledger-limit');const prizeMeta={prizeIndex:winners[i].prizeIndex,prizeName:winners[i].prizeName,prizeDescription:winners[i].prizeDescription};winners[i]={...winners[i],status:'replaced'};winners.push({...replacement,...prizeMeta,status:'pending',replaces:d.winnerKey});tx.set(control,{winnerKeys:[...new Set([...all,replacement.key])]},{merge:true});
  }else{if(winners[i].status!=='pending')throw Error('winner-already-handled');winners[i]={...winners[i],status:d.action==='claim'?'claimed':'forfeited',handledAt:now,handledBy:a.uid,reason};}
  tx.update(raffle,{winners,revision:(data.revision||0)+1});tx.set(activity,{lastAt:now},{merge:true});tx.create(operation,{type:'raffle-winner',action:d.action,raffleId:rid,winnerKey:d.winnerKey,reason,at:now,actor:a.uid});return {ok:true};
 });}catch(e){err(e);}
});
