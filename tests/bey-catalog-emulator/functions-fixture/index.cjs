'use strict';
/** Public CI fixture only. No private DATA-01B source and no deploy script. */
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {onRequest}=require('firebase-functions/v2/https');
const {createTw13HttpV2Handler}=require('../../../modules/bey-catalog/catalog-tw13-http-v2.cjs');
const PROJECT='demo-bxh-catalog-db01';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')
 throw Error('CATALOG_FUNCTIONS_FIXTURE_EMULATORS_REQUIRED');
const app=initializeApp({projectId:PROJECT},'catalog-functions-emulator-fixture');
exports.catalogReview=createTw13HttpV2Handler({
 onRequest,allowedOrigins:['https://arena.bxh.com.tw'],dependencies:{
  allowedAppIds:['functions-emulator-test-app'],
  adminAppCheck:{verifyToken:async token=>{
   if(token!=='functions-emulator-app-check')throw Error('INVALID_APP_CHECK');
   return {appId:'functions-emulator-test-app'};
  }},
  adminAuth:getAuth(app),adminFirestore:getFirestore(app),
  loadResearchBatch:async()=>{throw Error('PRIVATE_RESEARCH_NOT_AVAILABLE_IN_PUBLIC_CI');},
  consumeRateLimit:async()=>true,recordAudit:async()=>true
 }
});
