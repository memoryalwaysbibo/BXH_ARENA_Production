'use strict';
// Copied to an ephemeral Functions source package by prepare-callable-lab.cjs.
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{onCall,HttpsError}=require('firebase-functions/v2/https');
initializeApp({projectId:'demo-bxh-four-court-buckets'});
const {createBucketScoringHandler}=require('./bucket-scoring-service.cjs'),{createBucketSeatHandler}=require('./bucket-seat-service.cjs'),{createBucketCallableDefinitions}=require('./bucket-callable.cjs');let handlers;
function getHandlers(){
 if(process.env.GCLOUD_PROJECT!=='demo-bxh-four-court-buckets'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9198')throw Error('emulator-only');
 return handlers||(handlers={score:createBucketScoringHandler(getFirestore()),seat:createBucketSeatHandler(getFirestore())});
}
Object.assign(exports,createBucketCallableDefinitions({onCall,HttpsError,scoreHandler:request=>getHandlers().score(request),seatHandler:request=>getHandlers().seat(request)}));
