'use strict';
// Independently verify the complete immutable RDW snapshot contents, not only
// the presence of a sealed flag and a 64-char digest. No Firestore writes.
const {buildRosterSnapshot}=require('./rdw-roster-tier-snapshot.cjs');
function validateSealedSnapshot({snapshot,eventCode,drawRevision,rosterUids}={}){
 if(!snapshot||snapshot.source!=='server'||snapshot.verified!==true||
    snapshot.sealed!==true||snapshot.version!=='rdw-roster-snapshot-v1'||
    snapshot.eventCode!==eventCode||snapshot.drawRevision!==drawRevision||
    !Array.isArray(rosterUids)||!Array.isArray(snapshot.tiers)||
    snapshot.rosterSize!==rosterUids.length)
  return {ok:false,reason:'sealed-snapshot-context-invalid'};
 try{
  const verifiedTiers=snapshot.tiers.map(t=>({
   ok:true,uid:t.uid,tier:t.tier,computedAt:t.computedAt,
   sourceScope:snapshot.sourceScope,sourceDigest:t.sourceDigest
  }));
  const expected=buildRosterSnapshot({
   eventCode,drawRevision,rosterUids,verifiedTiers,capturedAt:snapshot.capturedAt
  });
  if(snapshot.snapshotDigest!==expected.snapshotDigest||
     snapshot.rosterDigest!==expected.rosterDigest||
     snapshot.sourceScope!==expected.sourceScope||
     JSON.stringify(snapshot.tiers)!==JSON.stringify(expected.tiers))
   return {ok:false,reason:'sealed-snapshot-digest-mismatch'};
  return {ok:true,snapshotDigest:expected.snapshotDigest};
 }catch{return {ok:false,reason:'sealed-snapshot-invalid'};}
}
module.exports={validateSealedSnapshot};
