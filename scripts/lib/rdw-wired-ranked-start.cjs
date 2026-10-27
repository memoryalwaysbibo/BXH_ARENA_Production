'use strict';
// Concrete server composition. No caller-supplied verifier or dispatcher.
// The private Hunter bundle must still be provisioned and verified before release.
const {createVerifiedBracketReader}=require('./rdw-verified-bracket-reader.cjs');
const {createServerStartDispatch}=require('./rdw-server-start-dispatch.cjs');
const {createHunterVerifiedRankedStart}=require('./rdw-hunter-start-wiring.cjs');
function createWiredRankedStart({db,clock,bundleRoot,enabled=false}={}){
 if(!enabled)return async()=>({ok:false,code:'rdw-disabled'});
 return createHunterVerifiedRankedStart({db,clock,bundleRoot,enabled:true,
  verifyBracketInTransaction:createVerifiedBracketReader({db}),buildServerDispatch:createServerStartDispatch({db})});
}
module.exports={createWiredRankedStart};
