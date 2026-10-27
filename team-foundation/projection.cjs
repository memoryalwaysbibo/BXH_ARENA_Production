'use strict';
const {progression}=require('./progression.cjs');
const {admissionPolicy}=require('./admission.cjs');
const {roster}=require('./team-policy.cjs');
const TIERS=['ungraded','e','d','c','b','a','s','national'];
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);
// Refresh is server-only. All readers must use the provided transaction and canonical data.
// Never create fake zero scores, claim partially evaluated values are complete, or merge
// untrusted fields into a public projection. Source change triggers are not registered here.
function createProjectionWriter({db,readPlayers,clock=Date.now}){
 if(!db||typeof readPlayers!=='function')throw Error('projection-adapters-required');
 return async function refresh(teamId){
  if(!validId(teamId))throw Error('invalid-team-id');
  return db.runTransaction(async tx=>{
   const teamRef=db.doc('teamsV1/'+teamId),publicRef=db.doc('teamsPublicV1/'+teamId);
   const snap=await tx.get(teamRef);
   if(!snap.exists){tx.delete(publicRef);return {status:'removed'};}
   const team=snap.data();
   if(team.status==='dissolved'){tx.delete(publicRef);return {status:'removed'};}
   const roles=roster(team);
   const data=await readPlayers({tx,uids:[...team.memberUids]});
   if(!data||data.complete!==true||!Array.isArray(data.players))throw Error('incomplete-player-source');
   const map=new Map();for(const p of data.players){if(!validId(p?.uid)||map.has(p.uid)||!team.memberUids.includes(p.uid))throw Error('invalid-player-source');map.set(p.uid,p);}
   if(map.size!==team.memberUids.length)throw Error('incomplete-player-source');
   const members=team.memberUids.map(uid=>{
    const player=map.get(uid);
    if(typeof player.name!=='string'||!player.name.trim()||player.name.length>80)throw Error('invalid-public-name');
    if(player.ladderPoints!==null&&(!Number.isFinite(player.ladderPoints)||player.ladderPoints<0))throw Error('invalid-ladder-points');
    if(player.hunterTier!==null&&!TIERS.includes(player.hunterTier))throw Error('invalid-hunter-tier');
    return {uid,name:player.name.trim(),role:roles[uid],ladderPoints:player.ladderPoints,hunterTier:player.hunterTier};
   });
   const p=progression(team.totalXp),complete=members.every(m=>m.ladderPoints!==null);
   const current=clock();if(!Number.isSafeInteger(current)||current<0)throw Error('invalid-clock');
   const projection={status:'active',name:team.name,captainName:members.find(m=>m.uid===team.captainUid).name,
    level:p.level,capacity:p.capacity,memberCount:members.length,admission:admissionPolicy(team.admission),
    strength:complete?members.reduce((sum,m)=>sum+m.ladderPoints,0):null,strengthComplete:complete,
    members,createdAt:team.createdAt,updatedAt:current,hunterGeneration:data.hunterGeneration??null,sourceVersion:'team-public-v1'};
   tx.set(publicRef,projection);return {status:'updated',strengthComplete:complete};
  });
 };
}
// Concrete ladder source identification: ladderSystem/current + ladderPlayers/{uid}.
// A season mismatch is unknown, not zero; never silently fall back to careerPoints.
function createSeasonLadderReader({db}){
 return async function({tx,uids}){
  const control=await tx.get(db.doc('ladderSystem/current'));
  const season=control.exists?control.data()?.currentSeason:null;
  if(typeof season!=='string'||!season)throw Error('ladder-season-unavailable');
  const snaps=await Promise.all(uids.map(uid=>tx.get(db.doc('ladderPlayers/'+uid))));
  return new Map(uids.map((uid,i)=>{
   const d=snaps[i].exists?snaps[i].data():null;
   return [uid,{points:d?.currentSeason===season&&Number.isFinite(d.seasonPoints)&&d.seasonPoints>=0?d.seasonPoints:null,season}];
  }));
 };
}
module.exports={createProjectionWriter,createSeasonLadderReader};
