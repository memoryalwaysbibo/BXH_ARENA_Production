'use strict';
// RDW P3-34 server-side authorization for READ-ONLY diagnostics.
// Only explicit active system admins may view trusted Hunter evidence.
// Tournament host authorization is intentionally NOT inferred from client state.
const ADMIN_ROLES=new Set(['super_admin','admin']);
function createDiagnosticAdminAuthorizer({db}={}){
 if(typeof db?.doc!=='function')throw Error('server-firestore-required');
 return async function authorizeAdmin({actorUid,eventCode}={}){
  if(typeof actorUid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(actorUid)||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||''))return false;
  const snap=await db.doc('users/'+actorUid).get();
  if(!snap?.exists)return false;
  const profile=snap.data();
  return Boolean(profile&&profile.active===true&&ADMIN_ROLES.has(profile.role)&&profile.isTestAccount!==true);
 };
}
module.exports={createDiagnosticAdminAuthorizer};
