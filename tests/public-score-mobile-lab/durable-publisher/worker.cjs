'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('loopback-only');
const req=createRequire(path.resolve(__dirname,'../function-runtime/package.json')),{initializeApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const db=getFirestore(initializeApp({projectId:'demo-bxh-arena-e2e'})),schema=require('../public-schema.cjs'),{createPublisher}=require('./publisher.cjs'),{dispatchOnce}=require('./dispatcher.cjs');
const p=createPublisher(db,{mode:'offline-test',projectId:'demo-bxh-arena-e2e',room:'BXH-DEMO96',epoch:'demo-browser96'},{validate:v=>{if(fs.existsSync('evidence/worker-fail.flag'))throw Error('injected-publisher-failure');return schema.validate(v);}});
(async()=>{for(;;){try{const r=await dispatchOnce(db,p,'BXH-DEMO96');if(!r.duplicate&&!r.idle)console.log(JSON.stringify(r));}catch(e){console.log('WORKER_RETRY',e.message);if(e.message==='injected-publisher-failure')fs.writeFileSync('evidence/worker-failure-observed.flag','true');}await new Promise(r=>setTimeout(r,150));}})().catch(e=>{console.error(e);process.exit(1)});
