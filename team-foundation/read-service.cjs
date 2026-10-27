'use strict';
const {historyView,mayReadReason}=require('./history.cjs');
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
// actorUid MUST be provided by the server Auth boundary, not client JSON.
function createReadService({db}){
 const read=async(tx,path)=>{const snap=await tx.get(db.doc(path));return snap.exists?snap.data():null;};
 return async({actorUid,action,teamId,historyId})=>{
  if(!valid(actorUid)||!valid(teamId)||!['members','history','reason'].includes(action)||(action==='reason'&&!valid(historyId)))throw Error('invalid-read');
  return db.runTransaction(async tx=>{
   if(action==='members'){
    // Only a server-maintained public projection is exposed; raw team docs never returned.
    const data=await read(tx,'teamsPublicV1/'+teamId);
    if(!data||data.status==='dissolved')throw Error('team-not-found');
    return {id:teamId,name:data.name,members:(data.members||[]).map(p=>({uid:p.uid,name:p.name,role:p.role,ladderPoints:p.ladderPoints??null,hunterTier:p.hunterTier??null}))};
   }
   const team=await read(tx,'teamsV1/'+teamId),membership=await read(tx,'teamMembershipsV1/'+actorUid);
   if(action==='history'){
    if(team?.status==='dissolved'||membership?.teamId!==teamId||!team?.memberUids?.includes(actorUid))throw Error('permission-denied');
    // Bounded newest page. Pagination support is intentionally not implied.
    const query=db.collection('teamsV1/'+teamId+'/history').orderBy('occurredAt','desc').limit(50);
    const snaps=await tx.get(query);
    return {items:snaps.docs.map(s=>({id:s.id,...historyView(s.data())})),pageLimit:50};
   }
   const record=await read(tx,'teamsV1/'+teamId+'/history/'+historyId);
   if(!record)throw Error('history-not-found');
   const currentTeam=membership?.teamId===teamId?team:null;
   if(!mayReadReason({viewerUid:actorUid,record,team:currentTeam}))throw Error('permission-denied');
   const reason=await read(tx,'teamsV1/'+teamId+'/historyReasons/'+historyId);
   return reason?{code:reason.code,label:reason.label,note:reason.note}:null;
  });
 };
}
module.exports={createReadService};
