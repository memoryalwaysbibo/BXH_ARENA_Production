'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{run}=require('./async-pass-cases.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'async-pass-direct');
(async()=>{try{const cases=await run(getFirestore(app));const report={kind:'async-pass-native-transactions',productionWrites:0,automaticEventsVerified:false,cases};const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'async-pass-native.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS async PASS native transactions: '+JSON.stringify(report));}finally{await deleteApp(app);}})().catch(error=>{console.error(error);process.exitCode=1;});
