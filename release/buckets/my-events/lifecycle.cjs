'use strict';
// Offline candidate. Call inside the same Firestore read-only transaction used
// by the membership reader or repair engine; do not trust a caller's snapshot.
const C=require('../completion/certificate.cjs');
const result=(status,reason)=>Object.freeze({status,reason});
function phaseOf(top,state){
 if(top.systemClosed===true||state.systemClosure&&!state.systemClosure.restoredAt)return 'closed';
 if(top.eventCancelled===true||state.meta?.eventCancelled===true)return 'cancelled';
 if(top.archiveStatus==='completed'||state.archiveStatus==='completed')return 'done';
 const real=state.matches.filter(m=>!m.isBye);
 return !state.startedAt||real.length===0?'waiting':real.every(m=>m.completed)?'settling':'live';
}
async function readBucketLifecycle({db,tx,root,pub,normalizeRoom}){
 if(!db||!tx||!root||!pub||typeof normalizeRoom!=='function')return result('invalid','bucket-input-missing');
 let input,complete;
 try{
  input=await C.load({db,tx,root,pub});
  complete=C.completed(input);
 }catch{return result('invalid','bucket-lifecycle-unverified');}
 const {top,state}=input,phase=phaseOf(top,state);
 const allowed=phase==='settling'?['live','settling']:phase==='closed'?['done']:[phase];
 if(!allowed.includes(top.tournamentPhase))return result('invalid','bucket-phase-conflict');
 if((phase==='done')!==!!complete)return result('invalid','bucket-completion-unverified');
 // Canonical lifecycle checks still apply to cancellation, closure, selection,
 // unsupported modes and malformed state. Only the stale top phase is replaced.
 const life=normalizeRoom({...top,data:JSON.stringify(state),tournamentPhase:phase==='closed'?'done':phase});
 if(life.status!=='supported')return life;
 return Object.freeze({...life,source:'verified-buckets',epoch:input.m.epoch,roomIncarnation:input.sourceCreatedAt});
}
module.exports={readBucketLifecycle};
