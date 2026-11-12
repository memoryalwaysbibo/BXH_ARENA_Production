'use strict';
// Explicit deployment environment and transactional room/epoch gates are required.
function createBucketRuntime(db,{runtime='emulator',env=process.env}={}){
 if(runtime==='emulator'){
  if(db.projectId!=='demo-bxh-four-court-buckets'||env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188')throw Error('emulator-only');
 }else if(runtime==='production'){
  if(env.BXH_BUCKET_RUNTIME_ENABLED!=='true')throw Error('bucket-runtime-disabled');
  if(!env.BXH_BUCKET_PROJECT_ID||env.BXH_BUCKET_PROJECT_ID!==db.projectId||env.GCLOUD_PROJECT!==db.projectId||db.projectId.startsWith('demo-'))throw Error('bucket-project-mismatch');
  if(env.FUNCTIONS_EMULATOR||env.FIRESTORE_EMULATOR_HOST||env.FIREBASE_AUTH_EMULATOR_HOST||env.FIREBASE_DEBUG_MODE||env.FIREBASE_DEBUG_FEATURES)throw Error('bucket-runtime-mismatch');
 }else throw Error('invalid-bucket-runtime');
 return {assertRoom(config,manifest){
  if(config?.enabled!==true)throw Error('release-not-ready');
  if(runtime==='production'&&(config.productionEnabled!==true||!Object.hasOwn(config.productionRooms||{},manifest.code)||config.productionRooms[manifest.code]!==manifest.epoch))throw Error('bucket-room-not-enabled');
 }};
}
module.exports={createBucketRuntime};
