'use strict';
const {progression}=require('./progression.cjs');
const ROLES=Object.freeze({captain:1,deputy:2,elite:3,member:null});
const DAY=86400000;
function roster(team){
 if(!team||!Array.isArray(team.memberUids)||!team.memberUids.length||new Set(team.memberUids).size!==team.memberUids.length||!team.memberUids.includes(team.captainUid))throw Error('invalid-roster');
 const roles={};for(const uid of team.memberUids){
  const role=uid===team.captainUid?'captain':(team.roles?.[uid]||'member');
  if(!Object.hasOwn(ROLES,role)||role==='captain'&&uid!==team.captainUid)throw Error('invalid-role');roles[uid]=role;
 }
 for(const role of ['captain','deputy','elite'])if(Object.values(roles).filter(x=>x===role).length>ROLES[role])throw Error('role-full');
 if(team.memberUids.length>progression(team.totalXp).capacity)throw Error('team-full');
 return roles;
}
function assignRole(team,actorUid,targetUid,role){
 const roles=roster(team);if(actorUid!==team.captainUid)throw Error('captain-required');
 if(!Object.hasOwn(roles,targetUid))throw Error('not-member');
 if(targetUid===team.captainUid||!['deputy','elite','member'].includes(role))throw Error('use-captain-transfer');
 const next={...team,roles:{...roles,[targetUid]:role}};roster(next);return next;
}
function canManage(team,actorUid,action,targetUid){
 const roles=roster(team), role=roles[actorUid];
 if(role==='captain')return action==='remove'?targetUid!==actorUid&&Object.hasOwn(roles,targetUid):['review','edit','assign','transfer'].includes(action);
 if(role==='deputy')return action==='review'||action==='remove'&&roles[targetUid]==='member';
 return false;
}
// Call inside the membership transaction whenever the roster changes.
function populationState(team,now){
 roster(team);if(!Number.isSafeInteger(now)||now<0)throw Error('invalid-time');
 if(team.memberUids.length>=2)return {understaffedSince:null,dissolveAt:null};
 const since=team.understaffedSince==null?now:team.understaffedSince;
 if(!Number.isSafeInteger(since)||since<0||since>now)throw Error('invalid-understaffed-time');
 return {understaffedSince:since,dissolveAt:since+DAY};
}
function canDissolve(team,actorUid,now,{automatic=false}={}){
 roster(team);if(team.memberUids.length!==1)return false;
 if(!automatic)return actorUid===team.captainUid;
 return Number.isSafeInteger(now)&&Number.isSafeInteger(team.understaffedSince)&&team.understaffedSince>=0&&now>=team.understaffedSince+DAY;
}
function selectFrame(team,actorUid,frame){
 roster(team);if(actorUid!==team.captainUid)throw Error('captain-required');
 if(frame!==null&&!progression(team.totalXp).unlockedFrames.includes(frame))throw Error('frame-locked');
 return {...team,selectedFrame:frame};
}
module.exports={ROLES,DAY,roster,assignRole,canManage,populationState,canDissolve,selectFrame};
