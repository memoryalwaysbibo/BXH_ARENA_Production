'use strict';
/**
 * TW-11 role policy mirrors the production Firestore Rules:
 *   active == true && !hasTestIdentity(user)
 *   && (role == 'super_admin' || role == 'admin')
 * Production reference: BXH_ARENA_Functions_Deploy/
 *   production-firestore-rules/firestore.rules, isAdminData / hasTestIdentity.
 *
 * This is a server-side authorization predicate, not a substitute for
 * Firebase Auth verification, a trusted users/{uid} lookup, or IAM.
 */
const ADMIN_ROLES=Object.freeze(['admin','super_admin']);
function hasTestIdentity(profile){
 return !!profile&&typeof profile==='object'&&
  (profile.role==='tester'||profile.isTestAccount===true);
}
function isActiveCatalogAdmin(profile){
 return !!profile&&typeof profile==='object'&&
  profile.active===true&&!hasTestIdentity(profile)&&
  ADMIN_ROLES.includes(profile.role);
}
function projectTrustedUserProfile(data){
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 return Object.freeze({
  role:data.role,
  active:data.active===true,
  isTestAccount:data.isTestAccount===true
 });
}
module.exports={ADMIN_ROLES,hasTestIdentity,isActiveCatalogAdmin,projectTrustedUserProfile};
