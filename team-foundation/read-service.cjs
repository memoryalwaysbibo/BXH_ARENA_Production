'use strict';
const {admissionPolicy}=require('./admission.cjs');
const {historyView,mayReadReason}=require('./history.cjs');
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
// actorUid MUST be provided by the server Auth boundary, not client JSON.
function createReadService({db}){
 const read=async(tx,path)=>{const snap=await tx.get(db.doc(path));return snap.exists?snap.data():null;};
 return async({actorUid,action,teamId,historyId,cursor})=>{
  if(!valid(actorUid)||!['members','history','reason','mine','applications'].includes(action)||(action!=='mine'&&!valid(teamId))||(action==='reason'&&!valid(historyId)))throw Error('invalid-read');
  return db.runTransaction(async tx=>{
   if(action==='mine'){
    const member=await read(tx,'teamMembershipsV1/'+actorUid);
    if(!member)return {team:null};
    if(!valid(member.teamId))throw Error('membership-unavailable');
    const own=await read(tx,'teamsV1/'+member.teamId);
    if(!own||own.status==='dissolved'||!own.memberUids?.includes(actorUid))throw Error('membership-unavailable');
    const role=own.captainUid===actorUid?'captain':own.roles?.[actorUid]||'member';
    return {team:{id:member.teamId,name:own.name,role,admission:['captain','deputy'].includes(role)?admissionPolicy(own.admission):null}};
   }
   if(action==='members'){
    // Only a server-maintained public projection is exposed; raw team docs never returned.
    const [data,team,board,ladder]=await Promise.all([read(tx,'teamsPublicV1/'+teamId),read(tx,'teamsV1/'+teamId),read(tx,'hunterLeaderboardMeta/current'),read(tx,'ladderSystem/current')]);
    if(!data||!team||team.status==='dissolved')throw Error('team-not-found');
    if(!board?.generation||!ladder?.currentSeason||data.hunterGeneration!==board.generation||data.ladderSeason!==ladder.currentSeason)throw Error('projection-stale');
    if(!Array.isArray(data.members)||!Array.isArray(team.memberUids)||data.members.length!==team.memberUids.length||data.members.some((p,i)=>p.uid!==team.memberUids[i]||p.role!==(p.uid===team.captainUid?'captain':team.roles?.[p.uid]||'member')))throw Error('projection-stale');
    return {id:teamId,name:data.name,members:(data.members||[]).map(p=>({uid:p.uid,name:p.name,role:p.role,ladderPoints:p.ladderPoints??null,hunterTier:p.hunterTier??null}))};
   }
   const team=await read(tx,'teamsV1/'+teamId),membership=await read(tx,'teamMembershipsV1/'+actorUid);
   if(action==='applications'){
    if(team?.status!=='active'||membership?.teamId!==teamId||!team.memberUids?.includes(actorUid)||!(team.captainUid===actorUid||team.roles?.[actorUid]==='deputy'))throw Error('permission-denied');
    // At most 20 profiles per request; expose only public display names and application time.
    const snaps=await tx.get(db.collection('teamsV1/'+teamId+'/applications').where('status','==','pending').limit(21));
    const page=snaps.docs.slice(0,20);
    const profiles=await Promise.all(page.map(s=>read(tx,'publicPlayers/'+s.id)));
    return {items:page.map((s,i)=>({uid:s.id,name:typeof profiles[i]?.publicName==='string'&&profiles[i].publicName.trim()?profiles[i].publicName.trim():'玩家',requestedAt:s.data().requestedAt})),hasMore:snaps.docs.length>20};
   }
   if(action==='history'){
    if(cursor!==undefined&&cursor!==null&&!valid(cursor))throw Error('invalid-history-cursor');
    if(team?.status==='dissolved'||membership?.teamId!==teamId||!team?.memberUids?.includes(actorUid))throw Error('permission-denied');
    let query=db.collection('teamsV1/'+teamId+'/history').orderBy('occurredAt','desc');
    if(cursor){const anchor=await tx.get(db.doc('teamsV1/'+teamId+'/history/'+cursor));if(!anchor.exists)throw Error('invalid-history-cursor');query=query.startAfter(anchor);}
    const snaps=await tx.get(query.limit(51));const page=snaps.docs.slice(0,50);
    return {items:page.map(s=>({id:s.id,...historyView(s.data())})),pageLimit:50,nextCursor:snaps.docs.length>50?page[page.length-1].id:null};
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
