'use strict';
// P3-25C: canonical ARENA event read adapter. Read-only and intentionally NOT a start writer.
// Caller must separately verify organizer grants + bracket signature with server records.
const {readCanonicalEvent}=require('./rdw-production-event-guard.cjs');
function createCanonicalRoomReader({db}={}){
 if(typeof db?.doc!=='function')throw Error('firestore-db-required');
 return async function read({eventCode,expectedRosterRevision,actorUid,tx}={}){
  if(typeof eventCode!=='string'||!/^BXH-[A-Z0-9]{6}$/.test(eventCode))return {ok:false,reason:'invalid-event-code'};
  if(typeof actorUid!=='string'||!actorUid.trim())return {ok:false,reason:'actor-required'};
  if(!Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0)return {ok:false,reason:'revision-required'};
  // Never accept a client-supplied room object. Obtain the canonical private room from Firestore.
  const ref=db.doc('tournaments/'+eventCode);
  const snap=tx?await tx.get(ref):await ref.get();
  if(!snap?.exists)return {ok:false,reason:'room-not-found'};
  return readCanonicalEvent({room:snap.data(),eventCode,expectedRosterRevision,actorUid});
 };
}
module.exports={createCanonicalRoomReader};
