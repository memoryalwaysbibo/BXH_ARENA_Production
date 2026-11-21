'use strict';
// Isolated R2 source-contract proof, not an Arena server writer. Read only the
// public bracket; do not repair old raw .data or emit player identities.
const MAX_BRACKET_BYTES=1024*1024;
const MAX_ROSTER_ROWS=512;
const known=count=>({status:'known',count});
const unknown=()=>({status:'requires-canonical-backfill'});
function provePublicCardRegistrationCount(d){
 if(!d||d.visibility!=='public')return unknown();
 const confirmed=Math.max(0,Number(d.confirmedCount)||0);
 // Team count represents teams, not players, and does not use roster size.
 if(d.battleMode==='team')return known(confirmed);
 if(d.eventAuthority==='community'&&d.communityQuickRegistration===true&&
    Number.isSafeInteger(d.communityParticipantCount)&&d.communityParticipantCount>=0&&d.battleMode==='individual'){
  return known(d.communityParticipantCount);
 }
 if(typeof d.bracketView!=='string'||Buffer.byteLength(d.bracketView)>MAX_BRACKET_BYTES)return unknown();
 let body;
 try{body=JSON.parse(d.bracketView);}catch{return unknown();}
 if(!body||typeof body!=='object'||Array.isArray(body))return unknown();
 const meta=body.meta||{};
 const mode=d.battleMode||meta.battleMode;
 if(mode==='team')return known(confirmed);
 const community=(d.eventAuthority||meta.eventAuthority)==='community';
 const quick=community&&(Object.hasOwn(d,'communityQuickRegistration')?d.communityQuickRegistration===true:meta.communityQuickRegistration===true);
 if(quick&&Number.isSafeInteger(d.communityParticipantCount)&&d.communityParticipantCount>=0)return known(d.communityParticipantCount);
 // Modern writer always provides sanitized players. Missing/foreign shape,
 // missing stable ids and data-only history require canonical backfill.
 const rows=body.players;
 if(!Array.isArray(rows)||rows.length>MAX_ROSTER_ROWS)return unknown();
 if(rows.some(x=>!x||typeof x!=='object'||!['string','number'].includes(typeof x.id)||!String(x.id)))return unknown();
 // Sanitized shape only carries id, name and checkedIn; private ids are not
 // required for deduplication and never read or emitted here.
 return known(Math.max(confirmed,new Set(rows.map(x=>String(x.id))).size));
}
module.exports={provePublicCardRegistrationCount};
