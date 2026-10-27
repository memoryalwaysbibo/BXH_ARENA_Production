'use strict';
const valid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
// Event payload is never trusted as a copy of current data. Always rebuild from canonical sources.
function createProjectionEvents({db,refresh,enabled=()=>false}){
 if(!db||typeof refresh!=='function'||typeof enabled!=='function')throw Error('projection-event-dependencies-required');
 async function invalidate(teamId){
  // Remove the old public projection before retrying. This prevents an out-of-date roster
  // being served after removal or dissolution while a source is unavailable.
  await db.runTransaction(async tx=>{const ref=db.doc('teamsPublicV1/'+teamId),snap=await tx.get(ref);if(snap.exists)tx.delete(ref);});
 }
 async function rebuild(teamId){if(!valid(teamId))throw Error('invalid-team-id');await invalidate(teamId);return refresh(teamId);}
 async function teamChanged(event){
  if(!enabled())return {status:'disabled'};
  return rebuild(event?.params?.teamId);
 }
 async function playerChanged(event){
  if(!enabled())return {status:'disabled'};
  const uid=event?.params?.uid;if(!valid(uid))throw Error('invalid-player-id');
  const m=await db.doc('teamMembershipsV1/'+uid).get();
  if(!m.exists)return {status:'not-a-member'};
  const teamId=m.data()?.teamId;if(!valid(teamId))throw Error('invalid-team-id');
  return rebuild(teamId);
 }
 return {teamChanged,playerChanged};
}
module.exports={createProjectionEvents};
