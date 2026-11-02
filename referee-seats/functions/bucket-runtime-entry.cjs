'use strict';
const {createBucketScoringHandler}=require('./bucket-scoring-service.cjs'),{createBucketSeatHandler}=require('./bucket-seat-service.cjs'),{createBucketPublicProjection}=require('./bucket-public-projection.cjs');
const {createBucketCallableDefinitions}=require('./bucket-callable.cjs'),{createBucketProjectionDefinition}=require('./bucket-projection-trigger.cjs');
// Lazy factories keep discovery and legacy entrypoints available while disabled.
// The formal index always uses production; only the demo fixture selects emulator.
function createBucketRuntimeDefinitions({db,onCall,HttpsError,onDocumentWritten,runtime='production'}){
 let handlers;
 function getHandlers(){
  if(runtime==='emulator'&&process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9198')throw Error('emulator-only');
  return handlers||(handlers={score:createBucketScoringHandler(db,{runtime}),seat:createBucketSeatHandler(db,{runtime}),publish:createBucketPublicProjection(db,{runtime})});
 }
 return {...createBucketCallableDefinitions({onCall,HttpsError,scoreHandler:request=>getHandlers().score(request),seatHandler:request=>getHandlers().seat(request)}),
  projectBucketPublicScore:createBucketProjectionDefinition({onDocumentWritten,publish:(code,options)=>{
   if(runtime==='production'&&process.env.BXH_BUCKET_RUNTIME_ENABLED!=='true')return {ok:true,skipped:true,reason:'bucket-runtime-disabled'};
   return getHandlers().publish(code,options);
  }})};
}
module.exports={createBucketRuntimeDefinitions};
