'use strict';
// P3-36: construct a trusted diagnostic with the verified Hunter 2.1 reader.
// Server-only, disabled by default. Requires a private audited bundle root.
// The result is a callable handler dependency, NOT a deployed entrypoint.
const {createVerifiedTierResolver}=require('./rdw-verified-tier-resolver.cjs');
const {createServerDiagnostic}=require('./rdw-server-diagnostic-wiring.cjs');
function createVerifiedHunterDiagnostic({db,clock,bundleRoot,enabled=false}={}){
 if(!enabled)return createServerDiagnostic();
 if(typeof db?.runTransaction!=='function'||typeof clock!=='function')throw Error('trusted-firestore-required');
 const resolve=createVerifiedTierResolver({db,clock,bundleRoot});
 return createServerDiagnostic({
  db,clock,enabled:true,
  readCurrentTierEvidence:async({uid})=>{
   try{
    const evidence=await resolve(uid);
    // A failed grade/provenance read is never treated as a trusted tier.
    return evidence?.ok===true?evidence:null;
   }catch{
    return null;
   }
  }
 });
}
module.exports={createVerifiedHunterDiagnostic};
