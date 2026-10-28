'use strict';
const {CAP,CONTROL}=require('./team-capacity.cjs');
const {roster}=require('./team-policy.cjs');
// Bounded, read-only audit. Not a public endpoint and not a replacement for a full
// membership/tenure migration audit. No writes, including when inconsistencies exist.
function createTeamReleaseAudit({db}){
 return async()=>db.runTransaction(async tx=>{
  const [teams,projections,control]=await Promise.all([tx.get(db.collection('teamsV1').where('status','==','active').limit(CAP+1)),tx.get(db.collection('teamsPublicV1').limit(CAP+1)),tx.get(db.doc(CONTROL))]);
  const issues=[],active=new Map(teams.docs.map(d=>[d.id,d.data()]));
  if(teams.docs.length>CAP)issues.push('active-team-cap-exceeded');
  if(projections.docs.length>CAP)issues.push('public-projection-cap-exceeded');
  const counter=control.exists?control.data()?.activeCount:null;
  if(!Number.isSafeInteger(counter)||counter<0||counter>CAP)issues.push('capacity-uninitialized-or-invalid');
  else if(teams.docs.length<=CAP&&counter!==teams.docs.length)issues.push('capacity-count-mismatch');
  const owners=new Map(),invalidTeams=[];
  for(const [id,team] of active){try{roster(team);}catch{invalidTeams.push(id);continue;}for(const uid of team.memberUids){if(owners.has(uid)&&owners.get(uid)!==id)issues.push('duplicate-member-across-teams');owners.set(uid,id);}}
  if(invalidTeams.length)issues.push('invalid-active-roster');
  const projected=new Set(projections.docs.map(d=>d.id)),missingProjectionIds=[...active.keys()].filter(id=>!projected.has(id));
  if(missingProjectionIds.length)issues.push('missing-public-projections');
  const staleProjectionIds=[];
  for(const d of projections.docs){const p=d.data(),team=active.get(d.id);if(!team||p.name!==team.name||!Array.isArray(p.members)||!Array.isArray(team.memberUids)||p.members.length!==team.memberUids.length||p.members.some((m,i)=>m?.uid!==team.memberUids[i]||m?.role!==(m?.uid===team.captainUid?'captain':team.roles?.[m?.uid]||'member')))staleProjectionIds.push(d.id);}
  if(staleProjectionIds.length)issues.push('stale-or-orphan-public-projections');
  return {readyForNextCheck:issues.length===0,issues:[...new Set(issues)],activeCount:teams.docs.length,activeCountIsTruncated:teams.docs.length>CAP,projectionCount:projections.docs.length,projectionCountIsTruncated:projections.docs.length>CAP,recordedCount:counter,invalidTeamIds:invalidTeams,staleProjectionIds,missingProjectionIds};
 });
}
module.exports={createTeamReleaseAudit};
