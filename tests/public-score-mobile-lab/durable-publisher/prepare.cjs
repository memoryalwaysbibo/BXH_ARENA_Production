'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');process.chdir(root);
if(!/^BXH-[A-Z0-9]{6}$/.test('BXH-DEMO96'))throw Error('invalid-app-room-fixture');
let source=fs.readFileSync('function-runtime/index.js','utf8');
const anchor='const score=createScoringHandler(getFirestore());';if(source.split(anchor).length!==2)throw Error('runtime-anchor');
const config={mode:'offline-test',projectId:'demo-bxh-arena-e2e',room:'BXH-DEMO96',epoch:'demo-browser96'};
source=source.replace(anchor,`const p=require(${JSON.stringify(path.join(__dirname,'publisher.cjs'))}).createPublisher(getFirestore(),${JSON.stringify(config)});const score=require(${JSON.stringify(path.join(__dirname,'scoring-adapter.cjs'))}).createScoringWithOutbox(getFirestore(),p);`);fs.writeFileSync('function-runtime/index.js',source);
let rules=fs.readFileSync('../e2e/firestore.rules','utf8');const match='match /databases/{database}/documents {';if(!rules.includes(match))throw Error('rules-anchor');rules=rules.replace(match,match+`\n match /labRooms/{room}/{rest=**} { allow read: if room == 'BXH-DEMO96'; allow write: if false; }`);fs.writeFileSync('durable-publisher/runtime.rules',rules);
let entry=fs.readFileSync('full-app-entry.mjs','utf8').replace("projectId:'demo-arena-public-delta'","projectId:'demo-bxh-arena-e2e'").replace("db,'127.0.0.1',18786","db,'127.0.0.1',8080").replace("epoch:'e-'+session.room","epoch:'demo-browser96'");fs.writeFileSync('durable-entry.mjs',entry);
let b=fs.readFileSync('referee-full-app-browser.mjs','utf8').replaceAll('BXH-REFU96','BXH-DEMO96').replaceAll("'e-'+code","'demo-browser96'");
b=b.replace("import {commit} from './mobile-fixture.mjs';","import {commit as unusedCommit} from './mobile-fixture.mjs';");
b=b.replace('async function publish(', 'async function commit(rows){return seedApp(rows);}\nasync function publish(');
const a=b.indexOf('  Object.assign(f.state,saved);'),z=b.indexOf('  await page.waitForFunction(at=>',a);if(a<0||z<0)throw Error('browser-anchor');
b=b.slice(0,a)+`  Object.assign(f.state,saved);view=S.publicProjection(saved,{meta:{stations:6},players:saved.players});
  if(requests.length===1){
   for(let i=0;i<100&&!fs.existsSync('evidence/worker-failure-observed.flag');i++)await new Promise(r=>setTimeout(r,100));
   assert(fs.existsSync('evidence/worker-failure-observed.flag'),'worker failure not observed');
   assert.notDeepEqual(await page.evaluate(()=>BXHFullAppLab.evidence.view),view,'failed worker unexpectedly updated spectator');
   fs.unlinkSync('evidence/worker-fail.flag');
   console.log('PASS real callable score committed despite publisher failure; recovery enabled without rescore');
  }
`+b.slice(z);
b=b.replace("const requests=[];","fs.writeFileSync('evidence/worker-fail.flag','true');\n const requests=[];");
b=b.replace('labPublisher:true,realDevices:false','labPublisher:true,automaticBackendPublisher:true,publisherFailureRecovery:true,manualBrowserPublication:false,realDevices:false');
b=b.replaceAll('referee-flow-','durable-flow-');fs.writeFileSync('durable-browser.mjs',b);
