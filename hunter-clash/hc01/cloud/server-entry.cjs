'use strict';
const PROJECT='bxh-hc-test';
for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[key]&&process.env[key]!==PROJECT)throw Error('cloud-test-project-mismatch');
if(![process.env.GCLOUD_PROJECT,process.env.GOOGLE_CLOUD_PROJECT].includes(PROJECT)||process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('cloud-test-runtime-required');
process.env.HC_RUNTIME_MODE='isolated-cloud-test';
const {onCall,HttpsError}=require('firebase-functions/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {createLifecycleService}=require('../service.cjs');
const {createCallableHandler}=require('../callable.cjs');
const app=initializeApp();if(app.options.projectId!==PROJECT)throw Error('cloud-test-project-mismatch');
const service=createLifecycleService({db:getFirestore(app),auth:getAuth(app)},process.env,{expectedCloudProject:PROJECT});
// Callable transport is reachable over HTTPS; Auth + App Check + DB allowlist restrict every command.
exports.hc01Command=onCall({region:'asia-east1',timeoutSeconds:30,enforceAppCheck:true,invoker:'public',
  cors:['https://bxh-hc-test-hc01.web.app','https://bxh-hc-test-hc01.firebaseapp.com']},createCallableHandler(service,HttpsError));
