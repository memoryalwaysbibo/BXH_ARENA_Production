'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {getFirestore}=require("./_qr_checkin/admin-firestore.cjs");
const {randomInt}=require('node:crypto');
const C=require('./operations-core');
const {assertLegacyRosterWritable}=require('./onsite-waitlist-writer-guards');
const db=getFirestore();
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function open(t,s){if(t.systemClosed||s.meta.eventCancelled||['done','cancelled','live','settling'].includes(t.tournamentPhase)||s.startedAt||s.bracketSize||s.matches.length||['completed','archived'].includes(s.archiveStatus))throw Error('entry-selection-locked');}
function pool(s){const p=C.candidates(s,'general');if(p.length>512)throw Error('entry-candidate-limit-512');return p;}
function shuffle(items){const out=items.slice();for(let i=0;i<out.length;i++){const j=randomInt(i,out.length);[out[i],out[j]]=[out[j],out[i]];}return out;}
exports.manageEntrySelection=onCall({region:'asia-east1',cors:true,timeoutSeconds:60},async req=>{
 const d=req.data||{},uid=req.auth?.uid,code=String(d.code||'').toUpperCase();
 if(!uid)throw new HttpsError('unauthenticated','auth-required');
 if(!valid(code)||!['configure','preview','draw','promote'].includes(d.action))throw new HttpsError('invalid-argument','invalid-entry-request');
 if(d.action!=='preview'&&!valid(d.operationId))throw new HttpsError('invalid-argument','operation-id-required');
 try{return await db.runTransaction(async tx=>{
  const ref=db.doc(`tournaments/${code}`),pub=db.doc(`publicTournaments/${code}`),record=db.doc(`tournaments/${code}/entrySelection/current`);
  const [u,t,p,r]=await Promise.all([tx.get(db.doc(`users/${uid}`)),tx.get(ref),tx.get(pub),tx.get(record)]);
  if(!u.exists||!t.exists||!C.canManage(u.data(),uid,t.data(),Date.now()))throw Error('tournament-access-denied');
  const tour=t.data();
  if([tour,p.data()].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))throw Error('bucket-scoring-required');
  const s=C.parseState(tour),old=r.data()||{},now=Date.now();if(tour.registrationSelection)throw Error('use-registration-selection');
  assertLegacyRosterWritable(tour,p.data(),s);
  let op=null;if(d.action!=='preview'){op=db.doc(`tournaments/${code}/entryOperations/${d.operationId}`);const prev=await tx.get(op);if(prev.exists){if(prev.data().actorUid!==uid||prev.data().requestHash!==C.poolHash(d))throw Error('operation-conflict');return {ok:true,state:s,replayed:true};}}
  open(tour,s);
  if(d.action==='preview'){
   if(old.status==='drawn')throw Error('already-selected');const candidates=pool(s);
   return {ok:true,candidates,candidateHash:C.poolHash(candidates),count:candidates.length};
  }
  let next={...old};
  if(d.action==='configure'){
   if(old.status==='drawn')throw Error('already-selected');
   if(!Number.isInteger(d.capacity)||d.capacity<2||d.capacity>512)throw Error('invalid-entry-capacity');
   next={status:'configured',capacity:d.capacity,configuredAt:now};
  }else if(d.action==='draw'){
   if(old.status!=='configured')throw Error('configure-entry-first');
   const candidates=pool(s);if(C.poolHash(candidates)!==d.candidateHash)throw Error('candidate-list-changed');
   if(candidates.length<old.capacity)throw Error('not-enough-checked-in');
   const ordered=shuffle(candidates),selected=ordered.slice(0,old.capacity),waiting=ordered.slice(old.capacity);
   next={...old,status:'drawn',selected,waiting,candidates,drawnAt:now};
   s.entryCandidates=s.players;s.players=selected.map(c=>s.entryCandidates.find(p=>String(p.id)===c.playerId));
  }else{
   if(old.status!=='drawn')throw Error('draw-entry-first');
   if(typeof d.reason!=='string'||d.reason.trim().length<2||d.reason.length>300)throw Error('replacement-reason-required');
   const at=old.selected.findIndex(x=>x.key===d.removeKey);if(at<0)throw Error('selected-player-not-found');
   if(!old.waiting.length)throw Error('no-waitlist');
   const selected=old.selected.slice(),waiting=old.waiting.slice(),removed=selected[at],promoted=waiting.shift();selected[at]=promoted;
   const player=s.entryCandidates?.find(x=>String(x.id)===promoted.playerId);if(!player)throw Error('candidate-missing');
   s.players=s.players.filter(x=>String(x.id)!==removed.playerId);s.players.push({...player,checkedIn:true});
   s.entryCandidates=s.entryCandidates.map(x=>String(x.id)===removed.playerId?{...x,withdrawn:true}:x);
   next={...old,selected,waiting,replacements:[...(old.replacements||[]),{removed,promoted,reason:d.reason.trim(),at:now,by:uid}]};
  }
  const revision=Number(tour.entrySelectionRevision||0)+1;
  s.entrySelection={status:next.status,capacity:next.capacity,selected:next.selected||[],waiting:next.waiting||[]};s.entrySelectionRevision=revision;s.updatedAt=now;
  tx.set(record,next);tx.set(ref,{data:JSON.stringify(s),entrySelectionRevision:revision,entrySelectionWriteRevision:revision,updatedAt:now},{merge:true});
  if(p.exists){let view={};try{view=JSON.parse(p.data().bracketView||'{}');}catch(e){throw Error('invalid-public-view');}
   // Keep only the existing public player schema; private candidate metadata stays private.
   view.players=s.players.map(x=>({id:x.id,name:x.name||'',checkedIn:x.checkedIn===true}));
   tx.set(pub,{bracketView:JSON.stringify(view),updatedAt:now},{merge:true});
  }
  tx.create(op,{actorUid:uid,requestHash:C.poolHash(d),action:d.action,createdAt:now,revision});
  return {ok:true,state:s};
 });}catch(e){throw new HttpsError('failed-precondition',e.message||'entry-selection-failed');}
});
