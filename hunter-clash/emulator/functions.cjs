'use strict';
// Emulator-only entry point. Never import this from the production Functions repository.
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
if(process.env.FUNCTIONS_EMULATOR!=='true' ||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')
  throw Error('sandbox-functions-only');
process.env.METADATA_SERVER_DETECTION='none';
const {onCall,HttpsError}=require('firebase-functions/https');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {createSandboxService}=require('../server/sandbox-service.cjs');
const {createCallableHandler}=require('../server/callable-handler.cjs');
const app=initializeApp({projectId:PROJECT});
const service=createSandboxService({db:getFirestore(app),auth:getAuth(app),
  serverTimestamp:()=>FieldValue.serverTimestamp()});
exports.hcSandboxCommand=onCall({region:'us-central1',timeoutSeconds:30,
  cors:[/^http:\/\/127\.0\.0\.1(?::\d+)?$/, /^http:\/\/localhost(?::\d+)?$/]},
  createCallableHandler(service,HttpsError));
