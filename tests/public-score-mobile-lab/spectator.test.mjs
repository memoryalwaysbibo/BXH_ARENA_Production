import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeApp,deleteApp} from 'firebase/app';
import {initializeFirestore,connectFirestoreEmulator,doc,getDocFromServer,setDoc,disableNetwork,enableNetwork,terminate,onSnapshot} from 'firebase/firestore';
import {spectatorTransport} from './spectator-transport.mjs';
import {createSpectator} from './spectator-lifecycle.mjs';
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

const app=initializeApp({projectId:project,apiKey:'demo',appId:'demo-spectator'});
const db=initializeFirestore(app,{});connectFirestoreEmulator(db,host,port);
const until=async f=>{const deadline=Date.now()+7000;while(!f()){if(Date.now()>deadline)throw Error('timeout '+f);await new Promise(r=>setTimeout(r,20));}};
let spectator,unrelatedStop;let displayed=null,active=0,callbacks=0,unrelatedCallbacks=0;const statuses=[],sources=[];
const context={route:'spectator',hidden:false,room:'spect96',epoch:'e-spect96',identity:'guest-session-a'};
try{
 await seed('spect96');await seed('spectOther');await seed('independent');
 unrelatedStop=onSnapshot(doc(db,'labRooms','independent','public','legacy'),s=>{if(s.exists()&&!s.metadata.fromCache)unrelatedCallbacks++;});
 const raw=spectatorTransport(db),wrap=stop=>{active++;let stopped=false;return()=>{if(!stopped){stopped=true;active--;stop();}};};
 const transport={...raw,
  subscribe(r,cb,err){const s=raw.subscribe(r,p=>{callbacks++;cb(p);},err);return {...s,stop:wrap(s.stop)};},
  legacy(r,cb,err){return wrap(raw.legacy(r,v=>{callbacks++;cb(v);},err));},
  watchAccess(r,cb,err){return wrap(raw.watchAccess(r,cb,err));}
 };
 spectator=createSpectator({transport,validateView:validate,onClear:()=>{displayed=null;},onView:(v,m)=>{displayed=v;sources.push(m.source);},onStatus:s=>statuses.push(s)});
 await spectator.setContext(context);await until(()=>spectator.snapshot()?.revision===0);assert.equal(active,2,'one access + one delta, no legacy');
 await spectator.setContext({...context,hidden:true});assert.equal(active,0);assert.equal(displayed,null);const idle=callbacks;
 for(let i=0;i<130;i++)await publish('spect96',s=>{s.matches[0].scoreA=i%2;});await new Promise(r=>setTimeout(r,100));assert.equal(callbacks,idle,'no background spectator callbacks');
 const independentBefore=unrelatedCallbacks;await publish('independent',s=>s.matches[0].scoreA++);await until(()=>unrelatedCallbacks>independentBefore);
 await spectator.setContext(context);await until(()=>spectator.snapshot()?.revision===130);assert(sources.includes('verified-cache'));assert.deepEqual(displayed,rooms.get('spect96').view);
 // Route away owns only spectator subscriptions and clears UI.
 await spectator.setContext({...context,route:'referee'});assert.equal(active,0);assert.equal(displayed,null);
 await spectator.setContext({...context,route:'registration'});assert.equal(active,0);
 await spectator.setContext({...context,route:'check-in'});assert.equal(active,0);
 // Rapid show/hide and room switch while authorize is still pending.
 const fast=spectator.setContext(context);await spectator.setContext({...context,hidden:true});await fast;assert.equal(active,0);assert.equal(displayed,null);
 const old=spectator.setContext(context);await spectator.setContext({...context,room:'spectOther',epoch:'e-spectOther'});await old;await until(()=>spectator.snapshot()?.revision===0);assert.deepEqual(displayed,rooms.get('spectOther').view);
 await publish('spect96',s=>s.matches[1].scoreA++);await new Promise(r=>setTimeout(r,100));assert.deepEqual(displayed,rooms.get('spectOther').view);
 // Corrupt delta rollback belongs to current spectator session only.
 await publish('spectOther',s=>s.matches[0].scoreA++,{bad:true});await until(()=>statuses.at(-1)?.state==='fallback');await until(()=>displayed?.matches[0].scoreA===1);
 await spectator.setContext({...context,room:'spectOther',epoch:'e-spectOther'});await until(()=>spectator.snapshot()?.revision===1);
 // Active rules revocation must clear UI and all spectator subscriptions.
 await commit([['labRooms/spectOther',{visibility:'private'}]]);await until(()=>displayed===null&&active===0);assert.equal(statuses.at(-1).state,'denied');
 const n=sources.length;await spectator.setContext({...context,room:'spectOther',epoch:'e-spectOther'});assert.equal(sources.length,n,'private room cache never displayed');assert.equal(displayed,null);
 // Identity change must not reuse cached values, even on still-public room.
 await spectator.setContext(context);const start=sources.length;await spectator.setContext({...context,identity:'another-identity'});assert(!sources.slice(start).includes('verified-cache'));
 await spectator.setContext({...context,hidden:true,identity:'another-identity'});await commit([['labRooms/spect96',{visibility:'private'}]]);const before=sources.length;await spectator.setContext({...context,identity:'another-identity'});assert.equal(sources.length,before);assert.equal(displayed,null);assert.equal(active,0);
 spectator.close();assert.equal(active,0);
 console.log(JSON.stringify({passed:true,actualFirestoreSdk:true,syntheticLifecycle:true,fixture:{players:96,courts:6},checks:['hidden idle no spectator callbacks','return server-validated cache then latest beyond 128 delta window','fast hide/show cancellation','route/room isolation','corrupt rollback','active visibility revocation clears UI','hidden revocation never replays cache','identity change clears cache','unrelated listener unaffected'],browser:false,wireBytes:null},null,2));
}finally{spectator?.close();unrelatedStop?.();await terminate(db);await deleteApp(app);}
