'use strict';
const {progression} = require('./progression.cjs');
const id = value => { if(typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw Error('invalid-id'); return value; };
// Server-only candidate. actorUid MUST come from verified Auth, never request data.
// No endpoint or production writes are registered by importing this module.
function createMembershipService({db,clock=Date.now}) {
 const ref = path => db.doc(path);
 const read = async(tx,r) => {const s=await tx.get(r); return s.exists?s.data():null;};
 return async function command({actorUid,action,teamId,targetUid,name}) {
  id(actorUid); id(teamId);
  if(!['create','apply','cancel','approve','reject','leave','remove','transfer'].includes(action)) throw Error('invalid-action');
  if(['approve','reject','remove','transfer'].includes(action)) id(targetUid);
  if(action==='create' && (typeof name!=='string'||name.trim().length<2||name.trim().length>24)) throw Error('invalid-name');
  return db.runTransaction(async tx=>{
   const tr=ref('teamsV1/'+teamId), ar=ref('teamMembershipsV1/'+actorUid);
   const team=await read(tx,tr), actor=await read(tx,ar);
   const now=clock();
   if(action==='create') {
    if(actor) throw Error('already-in-team'); if(team) throw Error('team-id-taken');
    tx.create(tr,{name:name.trim(),captainUid:actorUid,memberUids:[actorUid],totalXp:0,createdAt:now,selectedFrame:null});
    tx.create(ar,{teamId,joinedAt:now}); return {ok:true};
   }
   if(!team) throw Error('team-not-found');
   const members=team.memberUids;
   if(!Array.isArray(members)||new Set(members).size!==members.length||!members.includes(team.captainUid)) throw Error('invalid-team-state');
   const applicant=['approve','reject'].includes(action)?targetUid:actorUid;
   const qr=ref('teamsV1/'+teamId+'/applications/'+applicant);
   const application=await read(tx,qr);
   if(action==='apply') {
    if(actor) throw Error('already-in-team');
    if(members.length>=progression(team.totalXp).capacity) throw Error('team-full');
    if(application?.status==='pending') return {ok:true,duplicate:true};
    tx.set(qr,{uid:actorUid,status:'pending',requestedAt:now}); return {ok:true};
   }
   if(action==='cancel') {if(application?.status==='pending') tx.update(qr,{status:'cancelled',resolvedAt:now});return {ok:true};}
   if(action==='leave') {
    if(actor?.teamId!==teamId||!members.includes(actorUid)) throw Error('not-member');
    if(team.captainUid===actorUid) throw Error('transfer-captain-first');
    tx.update(tr,{memberUids:members.filter(x=>x!==actorUid)});tx.delete(ar);return {ok:true};
   }
   if(team.captainUid!==actorUid||actor?.teamId!==teamId) throw Error('captain-required');
   const ur=ref('teamMembershipsV1/'+targetUid), target=await read(tx,ur);
   if(action==='approve'||action==='reject') {
    if(application?.status!=='pending') throw Error('application-not-pending');
    if(action==='approve') {
     if(target||members.includes(targetUid)) throw Error('already-in-team');
     if(members.length>=progression(team.totalXp).capacity) throw Error('team-full');
     tx.create(ur,{teamId,joinedAt:now});tx.update(tr,{memberUids:[...members,targetUid]});
    }
    tx.update(qr,{status:action==='approve'?'approved':'rejected',resolvedAt:now});return {ok:true};
   }
   if(target?.teamId!==teamId||!members.includes(targetUid)) throw Error('not-member');
   if(targetUid===actorUid) throw Error('cannot-target-self');
   if(action==='transfer') tx.update(tr,{captainUid:targetUid});
   else {tx.update(tr,{memberUids:members.filter(x=>x!==targetUid)});tx.delete(ur);}
   return {ok:true};
  });
 };
}
module.exports={createMembershipService};
