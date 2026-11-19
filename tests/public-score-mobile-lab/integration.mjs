import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase/app';
import {initializeFirestore,connectFirestoreEmulator,doc,getDocFromServer,setDoc,disableNetwork,enableNetwork,terminate} from 'firebase/firestore';
import {sdkTransport} from './sdk-transport.mjs';
import {createAdapter} from './adapter.mjs';
const require=createRequire(import.meta.url),B=require('./bridge.cjs'),S=require('../../referee-seats/functions/scoring-core.cjs'),{validate}=require('./public-schema.cjs');
const project='demo-arena-public-delta',host='127.0.0.1',port=18786;
if(!project.startsWith('demo-')||host!=='127.0.0.1')throw Error('unsafe-emulator-config');
const base=`http://${host}:${port}/v1/projects/${project}/databases/(default)/documents`,name=`projects/${project}/databases/(default)/documents`;
const metrics={legacyOpen:0,legacyClose:0,legacyActive:0,legacyCallbacks:0,deltaPackets:0,packetJsonBytes:0,checkpoints:0};
const rooms=new Map();
async function commit(rows){
 const writes=rows.map(([path,data])=>({update:{name:name+'/'+path,fields:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,typeof v==='number'?{integerValue:String(v)}:{stringValue:v}]))}}));
 const response=await fetch(base+':commit',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify({writes})});
 if(!response.ok)throw Error('demo seed failed '+response.status+' '+await response.text());
}
async function seed(room){const state={meta:{stations:6},matches:Array.from({length:95},(_,i)=>({id:'m'+i,seq:i,round:0,station:i%6+1,a:{playerId:'a'+i},b:{playerId:'b'+i},scoreA:0,scoreB:0,log:[],status:'in_progress'})),courtAssignments:{},updatedAt:1};const view=validate(S.publicProjection(state,{meta:{stations:6},players:[]}));rooms.set(room,{state,view,revision:0});await commit([[`labRooms/${room}`,{visibility:'public'}],[`labRooms/${room}/public/legacy`,{view:JSON.stringify(view)}],[`labRooms/${room}/public/checkpoint`,{packet:JSON.stringify(B.checkpoint(view,'e-'+room,0))}]]);}
async function publish(room,mutate,{bad=false,drop=false}={}){const r=rooms.get(room),previous=r.view;mutate(r.state);r.state.updatedAt++;const next=validate(S.publicProjection(r.state,previous)),p=B.delta(previous,next,'e-'+room,r.revision++);r.view=next;const rows=[[`labRooms/${room}/public/legacy`,{view:JSON.stringify(next)}],[`labRooms/${room}/public/checkpoint`,{packet:JSON.stringify(B.checkpoint(next,'e-'+room,r.revision))}]];if(!drop)rows.push([`labRooms/${room}/deltas/${String(r.revision).padStart(6,'0')}`,{revision:r.revision,packet:JSON.stringify(bad?{...p,hash:'corrupt'}:p)}]);await commit(rows);}
const app=initializeApp({projectId:project,apiKey:'demo-only-not-a-secret',appId:'demo-public-delta'});
const db=initializeFirestore(app,{experimentalForceLongPolling:true});connectFirestoreEmulator(db,host,port);
let adapter;const statuses=[],views=[];
const until=async fn=>{const until=Date.now()+10000;while(!fn()){if(Date.now()>until)throw Error('timeout '+fn+' statuses='+JSON.stringify(statuses));await new Promise(r=>setTimeout(r,20));}};
try{
 await seed('lab96');await seed('other96');await commit([['privateRooms/secret',{secret:'synthetic-private-marker'}]]);
 await assert.rejects(getDocFromServer(doc(db,'privateRooms','secret')),e=>e.code==='permission-denied');
 await assert.rejects(setDoc(doc(db,'labRooms','lab96','public','legacy'),{view:'tamper'}),e=>e.code==='permission-denied');
 console.error('rules checks passed');
 const raw=sdkTransport(db);let inject=true;
 const transport={...raw,
  subscribe(room,cb,err){return raw.subscribe(room,p=>{metrics.deltaPackets++;metrics.packetJsonBytes+=Buffer.byteLength(JSON.stringify(p));cb(p);},err);},
  legacy(room,cb){metrics.legacyOpen++;metrics.legacyActive++;const stop=raw.legacy(room,v=>{metrics.legacyCallbacks++;validate(v);cb(v);});let closed=false;return()=>{if(closed)return;closed=true;stop();metrics.legacyClose++;metrics.legacyActive--;};},
  async checkpoint(room){metrics.checkpoints++;const p=await raw.checkpoint(room);validate(p.view);if(inject&&room==='lab96'){inject=false;await publish(room,s=>s.matches[0].scoreA++);}return p;}
 };
 adapter=createAdapter({transport,validateView:validate,onView:(v,m)=>{validate(v);views.push({v,m});},onStatus:s=>{statuses.push(s);console.error('status',s);}});
 await adapter.open('lab96','e-lab96');await until(()=>adapter.snapshot()?.revision===1);assert.equal(metrics.legacyActive,0);assert.deepEqual(adapter.snapshot().view,rooms.get('lab96').view);
 const metricStart={...metrics};let calculatedFullBytes=0;
 for(let i=0;i<16;i++){
  await publish('lab96',s=>{const m=s.matches[i%6];if(i<6){m.scoreA++;m.log.push({side:'A',points:1,finish:'spin',at:i+2});}else if(i<12){m.scoreA--;m.log.pop();}else if(i===12){m.skippedAt=20;m.callPass={waitFor:['m1']};m.passReturn={version:1,originStation:1,status:'waiting',skippedAt:20,waitFor:['m1']};}else if(i===13){m.completed=true;m.winnerId=m.a.playerId;s.matches[12].a={playerId:m.a.playerId};s.courtAssignments={court1:{currentMatchId:'m12'}};}else if(i===14){s.matches[0].passReturn={version:1,originStation:1,status:'assigned',skippedAt:20,assignedStation:2};}else{s.forcedCourtExits={1:{closed:true,revision:1}};}});
  await until(()=>adapter.snapshot()?.revision===i+2);assert.deepEqual(adapter.snapshot().view,rooms.get('lab96').view);calculatedFullBytes+=Buffer.byteLength(JSON.stringify(rooms.get('lab96').view));
 }
 const steady={updates:16,deltaPacketJsonBytes:metrics.packetJsonBytes-metricStart.packetJsonBytes,legacyCallbacks:metrics.legacyCallbacks-metricStart.legacyCallbacks,calculatedFullProjectionJsonBytes:calculatedFullBytes};assert.equal(steady.legacyCallbacks,0);
 // Actual SDK offline -> back online, with checkpoint recovery.
 await disableNetwork(db);await publish('lab96',s=>s.matches[0].scoreB++);await enableNetwork(db);await adapter.reconnect();await until(()=>adapter.snapshot()?.revision===18);assert.deepEqual(adapter.snapshot().view,rooms.get('lab96').view);
 // Corrupt public delta cannot partially commit; use legacy rollback then a checkpoint.
 await publish('lab96',s=>s.matches[1].scoreB++,{bad:true});await until(()=>statuses.at(-1)?.state==='fallback');assert.equal(metrics.legacyActive,1);await until(()=>views.at(-1)?.m.source==='legacy');assert.deepEqual(views.at(-1).v,rooms.get('lab96').view);await adapter.reconnect();await until(()=>adapter.snapshot()?.revision===19);
 const pending=adapter.open('lab96','e-lab96');await adapter.open('other96','e-other96');await pending;await until(()=>statuses.at(-1)?.room==='other96'&&statuses.at(-1)?.state==='live');await publish('lab96',s=>s.matches[2].scoreB++);await new Promise(r=>setTimeout(r,100));assert.deepEqual(adapter.snapshot().view,rooms.get('other96').view);
 await commit([['labRooms/other96',{visibility:'private'}]]);await assert.rejects(getDocFromServer(doc(db,'labRooms','other96','public','checkpoint')),e=>e.code==='permission-denied');
 adapter.close();assert.equal(metrics.legacyActive,0);
 console.log(JSON.stringify({passed:true,project,fixture:{syntheticPlayers:96,matches:95,courts:6},sdk:'firebase 11.10.0 Firestore onSnapshot/getDocFromServer',checks:['private read denied','client write denied','subscribe-checkpoint race','legacy stopped','score/undo/PASS/advancement transport parity','disableNetwork/enableNetwork reconnect','corrupt delta rollback','room-switch isolation','private visibility read denied'],steady,metrics,wireBytes:null,notVerified:['browser/mobile','production room baseline','scoring engine command integration','production-ready schema','actual wire/billing']},null,2));
}finally{adapter?.close();await terminate(db);await deleteApp(app);}
