'use strict';
// RDW P3-34: audited read-only server wiring. No callable export, writes, or deployment.
const {createDiagnosticAdminAuthorizer}=require('./rdw-diagnostic-admin-authorizer.cjs');
const {createAdminDiagnosticService}=require('./rdw-admin-diagnostic-service.cjs');
function createServerDiagnostic({db,readCurrentTierEvidence,clock,enabled=false}={}){
 if(!enabled)return createAdminDiagnosticService();
 if(typeof db?.doc!=='function'||typeof readCurrentTierEvidence!=='function'||typeof clock!=='function')throw Error('diagnostic-server-wiring-required');
 const authorizeAdmin=createDiagnosticAdminAuthorizer({db});
 const readRoom=async({eventCode})=>{
  if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode||''))throw Error('invalid-event-code');
  const snap=await db.doc('tournaments/'+eventCode).get();
  return snap?.exists?snap.data():null;
 };
 return createAdminDiagnosticService({authorizeAdmin,readRoom,readCurrentTierEvidence,clock,enabled:true});
}
module.exports={createServerDiagnostic};
