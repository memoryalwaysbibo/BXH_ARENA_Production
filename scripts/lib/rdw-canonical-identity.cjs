'use strict';
// P3-12: conservative identity reconciliation for RDW server-side preflight.
// No Firestore writes. All aliases must agree; guardian/child identity is never inferred.
function canonicalUid(player){
 if(!player||typeof player!=='object')return {ok:false,reason:'invalid-player'};
 if(player.familyPlayerId||player.guardianUid)return {ok:false,reason:'guardian-or-family-player-needs-authoritative-mapping'};
 const fields=['accountUid','playerUid','registrationUid','uid'];
 const values=fields.map(k=>player[k]).filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim());
 if(values.length===0)return {ok:false,reason:'uid-missing'};
 if(new Set(values).size!==1)return {ok:false,reason:'uid-alias-conflict'};
 return {ok:true,uid:values[0]};
}
function resolveRoster(players){
 if(!Array.isArray(players)||players.length<2)return {ok:false,reason:'insufficient-players'};
 const uids=[];
 for(const player of players){const resolved=canonicalUid(player);if(!resolved.ok)return {ok:false,reason:resolved.reason};uids.push(resolved.uid);}
 if(new Set(uids).size!==uids.length)return {ok:false,reason:'duplicate-uid'};
 return {ok:true,uids};
}
module.exports={canonicalUid,resolveRoster};
