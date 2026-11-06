'use strict';
const {assertIsolated,PROJECT}=require('../../emulator/preflight.cjs');
assertIsolated(process.env);
if(process.env.FUNCTIONS_EMULATOR!=='true'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('hc01-emulator-only');
process.env.METADATA_SERVER_DETECTION='none';
const {onCall,HttpsError}=require('firebase-functions/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {createLifecycleService}=require('../service.cjs');
const {createCallableHandler}=require('../callable.cjs');
const app=initializeApp({projectId:PROJECT});
const service=createLifecycleService({db:getFirestore(app),auth:getAuth(app)});
exports.hc01Command=onCall({region:'us-central1',timeoutSeconds:30,
  cors:[/^http:\/\/127\.0\.0\.1(?::\d+)?$/]},createCallableHandler(service,HttpsError));
