'use strict';
const D=require('./domain.cjs'),S=require('./sources.cjs');
function finalMatch(m){return m&&!m.isBye&&m.completed===true&&(!m.status||m.status==='completed')
  &&!['revoked','revokedAt','cancelled','cancelledAt','voided','voidedAt','resultRevoked'].some(k=>m[k])
  &&m.a?.playerId&&m.b?.playerId&&m.a.playerId!==m.b.playerId&&[m.a.playerId,m.b.playerId].includes(m.winnerId);}
function fingerprint(m){return D.hash({a:m.a.playerId,b:m.b.playerId,winnerId:m.winnerId,scoreA:m.scoreA??null,scoreB:m.scoreB??null,resultMethod:m.resultMethod??null,confirmedByUid:m.confirmedByUid??null,confirmedAt:m.confirmedAt??null,completedAt:m.completedAt??null,revision:m.refereeSeatScoreRevision??null});}
async function resolve(tx,db,targetUid,entries,captureId=null){
  const rooms=new Map(),bindings=new Map();
  entryLoop: for(const e of entries){
    e.recognitionValid=false;e.recognitionReason='legacy-needs-explicit-recognition';
    if(!e.kind||e.status!=='active')continue;
    D.normalizeBackfill(e);
    const sourceUid=e.sourceUid||targetUid;
    if(sourceUid!==targetUid){
      if(!bindings.has(sourceUid)){const snap=await tx.get(db.doc('refereeCertificateUidBindings/'+sourceUid));bindings.set(sourceUid,snap.data());}
      if(bindings.get(sourceUid)?.primaryUid!==targetUid){e.recognitionReason='cross-account-link-unverified';continue;}
    }
    for(const key of e.sourceKeys||[e.sourceKey]){
    if(key.startsWith('historical:'))continue;
    const [kind,code,id]=key.split(':');
    if(!rooms.has(code)&&rooms.size>=D.LIMITS.rooms){e.recognitionReason='recognition-room-limit';continue entryLoop;}
    if(!rooms.has(code)){const snap=await tx.get(db.doc('tournaments/'+code));const r=snap.data();rooms.set(code,{room:r,state:S.parseState(r)});}
    const {room,state}=rooms.get(code);
    if(!room||!state){e.recognitionReason='source-room-unavailable';continue entryLoop;}
    const problem=S.validRoom(room,state);
    if(problem){e.recognitionReason=problem;continue entryLoop;}
    if(kind==='match'){
      const matches=(Array.isArray(state.matches)?state.matches:[]).filter(m=>m?.id===id);
      if(matches.length!==1||!finalMatch(matches[0])){e.recognitionReason='current-result-not-valid';continue entryLoop;}
      const current=fingerprint(matches[0]);
      if(e.id===captureId){e.sourceFingerprints={...e.sourceFingerprints,[key]:current};}
      else if(e.sourceFingerprints?.[key]!==current){e.recognitionReason='source-result-changed-requires-recognition';continue entryLoop;}
    } else if(kind==='event') {
      if(!S.completedEvent(room,state)){e.recognitionReason='event-not-completed';continue entryLoop;}
      const scale=S.actualSize(state);
      // Native event scale comes from canonical participants, never from a claimed larger number.
      e.size=scale.size;e.precision=scale.precision;
    }
    }
    e.recognitionValid=true;e.recognitionReason='explicit-responsibility-recognition';
  }
  return entries;
}
function unique(entries){
  const keys=new Set();
  for(const e of entries){if(e.status!=='active'||!e.kind)continue;
    for(const source of e.sourceKeys||[e.sourceKey]){const key=(e.kind==='auxiliary'?'auxiliary:':'')+source;
    if(keys.has(key))D.fail('failed-precondition','duplicate-recognition-source');keys.add(key);}
  }
}
// Global responsibility claims serialize competing people; release/reclaim is explicit and audited by service.
async function claims(tx,db,uid,before,after,actorUid,now){
  const keys=e=>e?.kind==='decision'&&e.status==='active'?(e.sourceKeys||[e.sourceKey]):[];
  const old=keys(before),next=keys(after),writes=[];
  for(const key of new Set([...old,...next])){
    const ref=db.doc('refereeCertificateDecisionClaims/'+D.hash(key)),snap=await tx.get(ref),claim=snap.data();
    if(next.includes(key)){
      if(claim?.active&&(claim.uid!==uid||claim.entryId!==after.id))D.fail('failed-precondition','decision-responsibility-already-claimed');
      writes.push([ref,{sourceKey:key,uid,entryId:after.id,active:true,updatedBy:actorUid,updatedAt:now,previousUid:claim?.uid||null}]);
    }else if(claim?.active&&claim.uid===uid&&claim.entryId===before.id){
      writes.push([ref,{...claim,active:false,updatedBy:actorUid,updatedAt:now}]);
    }
  }
  return writes;
}
module.exports={resolve,unique,finalMatch,claims};
