'use strict';
const {randomUUID}=require('node:crypto');
const {removalReason}=require('./history.cjs');
const {admissionPolicy,requireEligible}=require('./admission.cjs');
const {progression} = require('./progression.cjs');
const {roster,assignRole,canManage,populationState,canDissolve,selectFrame}=require('./team-policy.cjs');
const id = value => { if(typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw Error('invalid-id'); return value; };
// Server-only candidate. actorUid MUST come from verified Auth, never request data.
// No endpoint or production writes are registered by importing this module.
function createMembershipService({db,clock=Date.now,readEligibility,readDisplayName}) {
 const ref = path => db.doc(path);
 const read = async(tx,r) => {const s=await tx.get(r); return s.exists?s.data():null;};
 return async function command({actorUid,action,teamId,targetUid,name,role,frame,policy,reasonCode,reasonNote}) {
  id(actorUid); id(teamId);
  if(!['create','apply','cancel','approve','reject','leave','remove','transfer','assign','frame','dissolve','admission'].includes(action)) throw Error('invalid-action');
  if(['approve','reject','remove','transfer','assign'].includes(action)) id(targetUid);
  if(action==='create' && (typeof name!=='string'||name.trim().length<2||name.trim().length>24)) throw Error('invalid-name');
  const historyId=randomUUID();
  const removal=action==='remove'?removalReason(reasonCode,reasonNote):null;
  return db.runTransaction(async tx=>{
   const tr=ref('teamsV1/'+teamId), ar=ref('teamMembershipsV1/'+actorUid);
   const team=await read(tx,tr), actor=await read(tx,ar);
   const now=clock();
   const subjectUid=targetUid||actorUid;
   const display=async uid=>{const n=readDisplayName?await readDisplayName({tx,uid}):null;return typeof n==='string'&&n.trim()?n:uid;};
   const actorName=await display(actorUid),subjectName=subjectUid===actorUid?actorName:await display(subjectUid);
   const log=(method,actorRole)=>{
    tx.create(ref('teamsV1/'+teamId+'/history/'+historyId),{subjectUid,subjectName,actorUid,actorName,actorRole:actorRole||team?.roles?.[actorUid]||(team?.captainUid===actorUid?'captain':'member'),method,occurredAt:now});
    if(removal)tx.create(ref('teamsV1/'+teamId+'/historyReasons/'+historyId),{...removal,subjectUid,createdAt:now});
   };
   if(action==='create') {
    if(actor) throw Error('already-in-team'); if(team) throw Error('team-id-taken');
    const fresh={name:name.trim(),captainUid:actorUid,memberUids:[actorUid],roles:{[actorUid]:'captain'},totalXp:0,createdAt:now,selectedFrame:null,status:'active',admission:admissionPolicy()};
    tx.create(tr,{...fresh,...populationState(fresh,now)});
    tx.create(ar,{teamId,joinedAt:now});log('create','captain'); return {ok:true};
   }
   if(!team) throw Error('team-not-found');
   if(team.status==='dissolved')throw Error('team-dissolved');
   const members=team.memberUids;
   const roles=roster(team);
   const writeRoster=(next)=>{const cleaned={};for(const uid of next.memberUids)cleaned[uid]=uid===next.captainUid?'captain':(next.roles?.[uid]||'member');
    next={...next,roles:cleaned};roster(next);tx.update(tr,{memberUids:next.memberUids,captainUid:next.captainUid,roles:cleaned,...populationState(next,now)});};
   if(['dissolve','frame'].includes(action)){
    if(actor?.teamId!==teamId||team.captainUid!==actorUid)throw Error('captain-required');
    if(action==='frame'){tx.update(tr,{selectedFrame:selectFrame(team,actorUid,frame).selectedFrame});return {ok:true};}
    if(!canDissolve(team,actorUid,now))throw Error('team-must-be-solo');
    tx.update(tr,{status:'dissolved',dissolvedAt:now,dissolvedBy:actorUid,dissolveAt:null});tx.delete(ar);log('dissolve','captain');return {ok:true};
   }
   if(!Array.isArray(members)||new Set(members).size!==members.length||!members.includes(team.captainUid)) throw Error('invalid-team-state');
   if(action==='admission'){
    if(actor?.teamId!==teamId||!['captain','deputy'].includes(roles[actorUid]))throw Error('leadership-required');
    tx.update(tr,{admission:admissionPolicy(policy),admissionUpdatedAt:now,admissionUpdatedBy:actorUid});return {ok:true};
   }
   const applicant=['approve','reject'].includes(action)?targetUid:actorUid;
   const qr=ref('teamsV1/'+teamId+'/applications/'+applicant);
   const application=await read(tx,qr);
   if(action==='apply') {
    if(actor) throw Error('already-in-team');
    if(members.length>=progression(team.totalXp).capacity) throw Error('team-full');
    const admission=admissionPolicy(team.admission);
    if(admission.mode==='auto')await requireEligible({policy:admission,readEligibility,tx,uid:actorUid});
    if(admission.mode==='auto'){
     tx.create(ar,{teamId,joinedAt:now});writeRoster({...team,memberUids:[...members,actorUid],roles:{...roles,[actorUid]:'member'}});
     tx.set(qr,{uid:actorUid,status:'approved',requestedAt:application?.requestedAt??now,resolvedAt:now,method:'auto'});log('auto');return {ok:true,joined:true};
    }
    if(application?.status==='pending') return {ok:true,duplicate:true};
    tx.set(qr,{uid:actorUid,status:'pending',requestedAt:now}); return {ok:true};
   }
   if(action==='cancel') {if(application?.status==='pending') tx.update(qr,{status:'cancelled',resolvedAt:now});return {ok:true};}
   if(action==='leave') {
    if(actor?.teamId!==teamId||!members.includes(actorUid)) throw Error('not-member');
    if(team.captainUid===actorUid) throw Error('transfer-captain-first');
    writeRoster({...team,memberUids:members.filter(x=>x!==actorUid)});tx.delete(ar);log('leave',roles[actorUid]);return {ok:true};
   }
   const permission=['approve','reject'].includes(action)?'review':action;
   if(actor?.teamId!==teamId||!canManage(team,actorUid,permission,targetUid))throw Error('captain-required');
   const ur=ref('teamMembershipsV1/'+targetUid), target=await read(tx,ur);
   if(action==='approve'||action==='reject') {
    if(application?.status!=='pending') throw Error('application-not-pending');
    if(action==='approve') {
     if(target||members.includes(targetUid)) throw Error('already-in-team');
     if(members.length>=progression(team.totalXp).capacity) throw Error('team-full');
     tx.create(ur,{teamId,joinedAt:now});writeRoster({...team,memberUids:[...members,targetUid],roles:{...roles,[targetUid]:'member'}});log('approve',roles[actorUid]);
    }
    tx.update(qr,{status:action==='approve'?'approved':'rejected',resolvedAt:now});return {ok:true};
   }
   if(target?.teamId!==teamId||!members.includes(targetUid)) throw Error('not-member');
   if(targetUid===actorUid) throw Error('cannot-target-self');
   if(action==='assign') {const next=assignRole(team,actorUid,targetUid,role);writeRoster(next);}
   else if(action==='transfer')writeRoster({...team,captainUid:targetUid,roles:{...roles,[actorUid]:'member',[targetUid]:'captain'}});
   else {writeRoster({...team,memberUids:members.filter(x=>x!==targetUid)});tx.delete(ur);}
   log(action,roles[actorUid]);
   return {ok:true};
  });
 };
}
module.exports={createMembershipService};
