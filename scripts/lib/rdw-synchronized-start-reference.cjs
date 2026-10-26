'use strict';
// P3-45 reference writer for *already authorized and already sealed* ranked events.
// Not deployed or wired to start-tournament. No client-provided tier assertions.
// Mutates only legacy private JSON and public bracketView in ONE transaction.
// This narrow writer is NOT sufficient for production start until court assignments,
// bracket signature, and original client saveState transition are fully replicated.
const {compareMirrors}=require('./rdw-private-public-mirror-gate.cjs');
const {validateSealedSnapshot}=require('./rdw-sealed-snapshot-verifier.cjs');
const {verifyStartDispatch}=require('./rdw-start-dispatch-gate.cjs');
function parse(v){if(typeof v==='string'){try{return JSON.parse(v);}catch{return null;}}return v&&typeof v==='object'?v:null;}
async function writeSynchronizedStart({tx,eventRef,publicRef,snapshotRef,eventCode,expectedRosterRevision,drawRevision,serverTime,authorized=false,bracketVerified=false,snapshotCandidate=null,dispatchCandidate=null}={}){
 if(!tx||typeof tx.get!=='function'||typeof tx.update!=='function'||!eventRef||!publicRef||!snapshotRef)throw Error('trusted-transaction-required');
 if(authorized!==true||bracketVerified!==true||!Number.isSafeInteger(drawRevision)||drawRevision<0||!Number.isSafeInteger(serverTime)||serverTime<=0)return {committed:false,reason:'trusted-gate-required'};
 const [privateSnap,publicSnap,snapshotSnap]=await Promise.all([tx.get(eventRef),tx.get(publicRef),tx.get(snapshotRef)]);
 if(!privateSnap.exists||!publicSnap.exists||(!snapshotSnap.exists&&!snapshotCandidate))return {committed:false,reason:'required-document-missing'};
 const privateDoc=privateSnap.data(),publicDoc=publicSnap.data(),sealed=snapshotSnap.exists?snapshotSnap.data():snapshotCandidate;
 const check=compareMirrors({privateDoc,publicDoc,eventCode});
 if(!check.ok)return {committed:false,reason:check.reason};
 if(check.rosterRevision!==expectedRosterRevision)return {committed:false,reason:'roster-changed'};
 const p=parse(privateDoc.data),q=parse(publicDoc.bracketView);
 if(p.meta?.ladderMode!=='ranked'||p.meta?.eventAuthority!=='official')return {committed:false,reason:'not-authorized-ranked'};
 if(!sealed||sealed.source!=='server'||sealed.verified!==true||sealed.sealed!==true||
    sealed.eventCode!==eventCode||sealed.drawRevision!==drawRevision||
    !/^[a-f0-9]{64}$/.test(sealed.snapshotDigest||''))return {committed:false,reason:'snapshot-untrusted'};
 const canonicalUids=(p.players||[]).map(player=>player?.uid);
 const proof=validateSealedSnapshot({snapshot:sealed,eventCode,drawRevision,rosterUids:canonicalUids});
 if(!proof.ok)return {committed:false,reason:proof.reason};
 if(snapshotCandidate){
  const candidateProof=validateSealedSnapshot({snapshot:snapshotCandidate,eventCode,drawRevision,rosterUids:canonicalUids});
  if(!candidateProof.ok||candidateProof.snapshotDigest!==sealed.snapshotDigest)
   return {committed:false,reason:'snapshot-candidate-mismatch'};
 }
 // A start without server-computed dispatch must never become a persisted start.
 // Candidate must be created by an audited server dispatcher, never by the caller.
 if(!dispatchCandidate||typeof dispatchCandidate!=='object')return {committed:false,reason:'server-dispatch-unavailable'};
 const dispatchProof=verifyStartDispatch({before:p,after:dispatchCandidate,stationCount:p.meta?.stations});
 if(!dispatchProof.ok)return {committed:false,reason:dispatchProof.reason};
 if(!snapshotSnap.exists&&typeof tx.create!=='function')throw Error('trusted-snapshot-create-required');
 const nextPrivate={...p,matches:dispatchCandidate.matches,courtAssignments:dispatchCandidate.courtAssignments,startedAt:serverTime,rosterLocked:true,rdwStartMode:'rdw-verified',rdwSnapshotDigest:sealed.snapshotDigest};
 const nextPublic={...q,matches:dispatchCandidate.matches,courtAssignments:dispatchCandidate.courtAssignments,startedAt:serverTime};
 // No tx reads after this point. New snapshot and both mirrors commit together.
 if(!snapshotSnap.exists)tx.create(snapshotRef,snapshotCandidate);
 tx.update(eventRef,{data:JSON.stringify(nextPrivate),updatedAt:serverTime,rdwStartMode:'rdw-verified',rdwSnapshotDigest:sealed.snapshotDigest});
 tx.update(publicRef,{bracketView:JSON.stringify(nextPublic),updatedAt:serverTime});
 return {committed:true,mode:'rdw-verified'};
}
module.exports={writeSynchronizedStart};
