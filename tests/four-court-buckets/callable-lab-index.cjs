'use strict';
// Same bucket registration as the formal index, with an explicit demo runtime.
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{onCall,HttpsError}=require('firebase-functions/v2/https'),{onDocumentWritten}=require('firebase-functions/v2/firestore');
initializeApp({projectId:'demo-bxh-four-court-buckets'});
const {createBucketRuntimeDefinitions}=require('./bucket-runtime-entry.cjs');
Object.assign(exports,createBucketRuntimeDefinitions({db:getFirestore(),onCall,HttpsError,onDocumentWritten,runtime:'emulator'}));

