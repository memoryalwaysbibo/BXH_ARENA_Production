'use strict';
// Dedicated codebase export. Never reuses the sandbox Auth or accepts a project supplied by clients.
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app'),{getAuth}=require('firebase-admin/auth'),{getFirestore}=require('firebase-admin/firestore');
const {createService}=require('./service.cjs'),{createHandler}=require('./callable.cjs');
const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT;
if(project!=='bxh-arena'&&!(project==='demo-arena-pk'&&process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST))throw Error('project-mismatch');
const app=initializeApp({projectId:project});const db=getFirestore(app);
exports.hunterClashCommand=onCall({region:'asia-east1',enforceAppCheck:true,timeoutSeconds:30,maxInstances:10},createHandler(createService({db,auth:getAuth(app)}),HttpsError));
