'use strict';
// P3-22: deterministic event-wide tier snapshot, server-side reference only.
// No Firestore write is performed until every roster member passes provenance checks.
const crypto=require('node:crypto');
const TIERS=new Set(['ungraded','e','d','c','b','a','s','national']);
const SCOPE='public-official-canonical-self-history-v1';
function sha(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function buildRosterSnapshot({eventCode,drawRevision,rosterUids,verifiedTiers,capturedAt}){
 if(typeof eventCode!=='string'||!/^BXH-[A-Z0-9]{4,16}$/.test(eventCode)||!Number.isSafeInteger(drawRevision)||drawRevision<0||!Number.isSafeInteger(capturedAt)||capturedAt<=0)throw Error('snapshot-context-invalid');
 if(!Array.isArray(rosterUids)||rosterUids.length<2||rosterUids.length>320||!Array.isArray(verifiedTiers)||verifiedTiers.length!==rosterUids.length)throw Error('snapshot-roster-size-invalid');
 if(rosterUids.some(u=>typeof u!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(u))||new Set(rosterUids).size!==rosterUids.length)throw Error('snapshot-uid-duplicate-or-invalid');
 const byUid=new Map();
 for(const t of verifiedTiers){
  if(!t||typeof t.uid!=='string'||byUid.has(t.uid)||t.ok!==true||!TIERS.has(t.tier)||t.sourceScope!==SCOPE||typeof t.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(t.sourceDigest)||!Number.isSafeInteger(t.computedAt)||t.computedAt>capturedAt||t.computedAt<=0)throw Error('snapshot-tier-untrusted');
  byUid.set(t.uid,t);
 }
 const tiers=rosterUids.map(uid=>{const t=byUid.get(uid);if(!t)throw Error('snapshot-uid-tier-mismatch');return {uid,tier:t.tier,computedAt:t.computedAt,sourceDigest:t.sourceDigest};});
 if(byUid.size!==tiers.length)throw Error('snapshot-uid-tier-mismatch');
 const rosterDigest=sha(rosterUids);
 const payload={version:'rdw-roster-snapshot-v1',source:'server',verified:true,sealed:true,eventCode,drawRevision,capturedAt,rosterDigest,rosterSize:tiers.length,tiers,sourceScope:SCOPE};
 return {...payload,snapshotDigest:sha(payload)};
}
async function sealRosterSnapshot({tx,snapshotRef,snapshot}){
 if(!tx||typeof tx.get!=='function'||typeof tx.create!=='function'||!snapshotRef||!snapshot?.sealed||snapshot.source!=='server'||snapshot.verified!==true)throw Error('snapshot-seal-invalid');
 const existing=await tx.get(snapshotRef);
 if(existing?.exists){
  const old=existing.data();
  if(old?.snapshotDigest!==snapshot.snapshotDigest||old?.rosterDigest!==snapshot.rosterDigest||old?.eventCode!==snapshot.eventCode||old?.drawRevision!==snapshot.drawRevision)throw Error('snapshot-immutable-conflict');
  return {created:false,digest:snapshot.snapshotDigest};
 }
 tx.create(snapshotRef,snapshot);
 return {created:true,digest:snapshot.snapshotDigest};
}
module.exports={buildRosterSnapshot,sealRosterSnapshot};
