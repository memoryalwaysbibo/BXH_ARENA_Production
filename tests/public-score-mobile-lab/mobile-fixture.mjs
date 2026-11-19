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

export {seed,publish,commit,rooms};
