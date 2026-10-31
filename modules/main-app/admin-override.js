(function(root){
'use strict';
const operations=new Set(['draw-bracket','start-tournament']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
function allowed(profile){
 return !!profile&&profile.active===true&&!profile.isTestAccount&&!profile.deleted&&
  !['deleted','disabled','frozen'].includes(profile.accountStatus)&&['admin','super_admin'].includes(profile.role);
}
function validApproval(a){
 return !!a&&operations.has(a.operation)&&typeof a.id==='string'&&a.id.length>=16&&a.id.length<=80&&
  typeof a.actorUid==='string'&&!!a.actorUid&&typeof a.roomId==='string'&&!!a.roomId&&
  typeof a.code==='string'&&/^BXH-[A-Z0-9]+$/.test(a.code)&&Number.isSafeInteger(a.at)&&
  typeof a.reason==='string'&&a.reason.trim().length>0&&a.reason.length<=500&&
  Array.isArray(a.participantIds)&&a.participantIds.length>=2&&a.participantIds.length<=2048&&
  a.participantIds.every(id=>typeof id==='string'&&id.length>0&&id.length<=200)&&
  new Set(a.participantIds).size===a.participantIds.length&&
  Array.isArray(a.warnings)&&a.warnings.length<=20&&a.warnings.every(w=>typeof w==='string'&&w.length<=200);
}
function current(a,context,profile){
 return allowed(profile)&&validApproval(a)&&a.actorUid===context.actorUid&&a.roomId===context.roomId&&a.code===context.code;
}
// Called with the authenticated actor and profile read inside the write transaction.
// A confirmation grants one named operation, never a persistent bypass mode.
function record(a,context,profile,before,after,now=Date.now()){
 if(!current(a,context,profile))fail('admin-override-not-authorized');
 if(now<a.at||now-a.at>5*60*1000)fail('admin-override-expired');
 if(before?.id!==a.roomId||after?.id!==a.roomId)fail('admin-override-room-changed');
 if(before.startedAt||before.archiveStatus==='completed')fail('admin-override-event-locked');
 const known=new Set((before.players||[]).map(p=>String(p.id)));
 if(a.participantIds.some(id=>!known.has(id)))fail('admin-override-roster-changed');
 const paired=new Set((after.matches||[]).flatMap(m=>[m.a?.playerId,m.b?.playerId]).filter(Boolean).map(String));
 if(paired.size!==a.participantIds.length||a.participantIds.some(id=>!paired.has(id)))fail('admin-override-pairing-changed');
 if(a.operation==='draw-bracket'&&(!after.bracketDraw?.id||after.startedAt))fail('invalid-admin-draw');
 if(a.operation==='start-tournament'&&(!after.startedAt||!before.bracketSize))fail('invalid-admin-start');
 const prior=Array.isArray(before.adminOperationOverrides)?before.adminOperationOverrides:[];
 if(prior.some(r=>r.id===a.id))fail('admin-override-already-used');
 const audit={id:a.id,operation:a.operation,actorUid:context.actorUid,actorRole:profile.role,
  reason:a.reason,warnings:a.warnings.slice(),participantIds:a.participantIds.slice(),
  confirmedAt:a.at,committedAt:now,registrationRosterRevision:Number(before.registrationRosterRevision||0),
  qrCheckinRevision:Number(before.qrCheckinRevision||0)};
 return prior.concat(audit);
}
const api={allowed,current,record};
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHAdminOverride=api;
})(typeof window==='object'?window:globalThis);
