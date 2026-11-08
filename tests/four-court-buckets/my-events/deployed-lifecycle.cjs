'use strict';
// Canonical private-room semantics: cloud-runtime.js computeTournamentPhase,
// plus core.js schedulePhase system-closure precedence. See SOURCE-SEMANTICS.md.
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const result=(status,reason)=>Object.freeze({status,reason});
function parseState(room){
 if(!object(room)||typeof room.data!=='string')return null;
 try{const s=JSON.parse(room.data);return object(s)&&object(s.meta)&&Array.isArray(s.players)&&Array.isArray(s.matches)?s:null;}catch{return null;}
}
function normalizeLifecycle(room){
 const s=parseState(room);if(!s)return result('invalid','malformed-private-state');
 for(const x of [room,s,s.meta]){
  for(const k of ['systemClosed','eventCancelled'])if(own(x,k)&&typeof x[k]!=='boolean')return result('invalid','malformed-lifecycle-flag');
  if(own(x,'systemClosure')){const c=x.systemClosure;if(!object(c)||!Number.isFinite(c.closedAt)||c.closedAt<=0||own(c,'restoredAt')&&(!Number.isFinite(c.restoredAt)||c.restoredAt<c.closedAt))return result('invalid','malformed-system-closure');}
  if(x.battleMode==='team'||own(x,'teamRegistration')||x.onsiteWaitlistServerOwned===true)return result('unsupported','unsupported-room-mode');
 }
 const hasSelection=[room,s,s.meta].some(x=>own(x,'registrationSelection')||own(x,'entrySelection'));
 if(hasSelection){
  const a=room.registrationSelection,b=s.entrySelection,r=room.entrySelectionRevision;
  if(!object(a)||!object(b))return result('invalid','malformed-selection-state');
  if(a.status!=='drawn'||b.status!=='drawn')return result('unsupported','selection-not-finalized');
  if(b.mode!=='registration'||!Number.isSafeInteger(r)||r<1||room.entrySelectionWriteRevision!==r||s.entrySelectionRevision!==r)return result('invalid','selection-evidence-mismatch');
 }
 if(s.matches.some(m=>!object(m)))return result('invalid','malformed-match');
 if(room.systemClosed===true&&(room.systemClosure?.restoredAt||s.systemClosure?.restoredAt))return result('invalid','contradictory-system-closure');
 const closed=room.systemClosed===true||!!(s.systemClosure&&!s.systemClosure.restoredAt);
 const cancelled=room.eventCancelled===true||s.meta.eventCancelled===true;
 const archived=room.archiveStatus==='completed'||s.archiveStatus==='completed';
 let phase;
 if(closed)phase='closed';
 else if(cancelled)phase='cancelled';
 else if(archived)phase='done';
 else {
  const real=s.matches.filter(m=>!m.isBye);
  phase=!s.startedAt||real.length===0?'waiting':real.every(m=>m.completed)?'settling':'live';
 }
 // Existing source writers set top phase; a conflicting top phase is not a
 // second authority and must not quietly turn an active room into empty.
 if(typeof room.tournamentPhase!=='string'||!['waiting','live','settling','done','cancelled'].includes(room.tournamentPhase))return result('invalid','unsupported-top-phase');
 if(!closed&&room.tournamentPhase!==phase)return result('invalid','contradictory-private-phase');
 if(closed&&room.tournamentPhase!=='done')return result('invalid','contradictory-closed-phase');
 return Object.freeze({status:'supported',phase,active:['waiting','live','settling'].includes(phase)});
}
module.exports={normalizeLifecycle,parseState};
