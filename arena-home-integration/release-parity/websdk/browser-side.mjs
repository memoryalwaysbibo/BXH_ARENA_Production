// Isolated extraction: pre-existing R2 controller runs with real modular SDK
// metadata, so no manual source freshness overriding occurs.
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {getFirestore,connectFirestoreEmulator,doc,collection,query,where,onSnapshot,getDocFromServer}
 from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
const project='demo-bxh-arena-r2-websdk';
if(location.origin!=='http://127.0.0.1:4173'||location.pathname!=='/r2-isolated/')throw Error('r2-loopback-only');
const opt=new URLSearchParams(location.search).get('mode');
if(!['baseline','summary'].includes(opt))throw Error('r2-test-mode');
const app=initializeApp({projectId:project,apiKey:'demo-no-real-key',appId:'demo-r2-test'});
const db=getFirestore(app);
connectFirestoreEmulator(db,'127.0.0.1',8188);
const refs=Object.fromEntries(['first','delta','version'].map(x=>[x,doc(db,'arenaHomeLab',x)]));
const state={mode:opt,ids:[],counts:null,version:null,error:null,ready:true,watch:0,first:0,delta:0};
globalThis.r2=state;
function surface(values){
 const sorted=values.slice().sort((a,b)=>a.id.localeCompare(b.id));
 state.ids=sorted.map(v=>v.id);
 state.counts=Object.fromEntries(sorted.map(v=>[v.id,v.count]));
 for(const row of sorted){
  let li=document.getElementById(row.id);
  if(!li){li=document.createElement('li');li.id=row.id;document.querySelector('ul').append(li);}
  const label=row.id+': '+row.count;
  if(li.textContent!==label)li.textContent=label;
 }
 for(const li of document.querySelectorAll('li'))if(!state.ids.includes(li.id))li.remove();
}
async function point(name){
 state[name]++;
 const s=await getDocFromServer(refs[name]);
 if(!s.exists()||s.metadata.fromCache||s.metadata.hasPendingWrites)throw Error('r2-untrusted-point-'+name);
 return s.data();
}
globalThis.r2Start=()=>{
 if(state.started)throw Error('double-start');
 state.started=true;
 if(opt==='baseline'){
  // Same full public Watch target shape as pinned cloud-runtime.js.
  const q=query(collection(db,'publicTournaments'),where('visibility','==','public'));
  state.watch++;
  state.stop=onSnapshot(q,{includeMetadataChanges:true},snap=>{
   if(snap.metadata.fromCache||snap.metadata.hasPendingWrites||snap.empty)return;
   // Consume sanitized public bracket as the existing lobby does; validation
   // below uses known mirrored legacy count but does not run full Arena UI.
   surface(snap.docs.map(x=>({id:x.id,count:Math.max(x.data().confirmedCount,JSON.parse(x.data().bracketView).players.length)})));
   state.version='server';
  },e=>{state.error=e.code;});
 }else{
  const transport={synthetic:true,readFirst:()=>point('first'),readDelta:()=>point('delta'),
   watch(next,fail){
    state.watch++;
    return onSnapshot(refs.version,{includeMetadataChanges:true},s=>{
     if(s.exists())next({...s.data(),fromCache:s.metadata.fromCache,hasPendingWrites:s.metadata.hasPendingWrites});
    },fail);
   }};
  globalThis.BXH_ARENA_HOME_LAB_TRANSPORT=transport;
  const api=globalThis.BXHArenaHomeSummaryLab;
  const controller=api.create({transport:api.getLocalTransport(),notify:()=>{
   const s=controller.snapshot();
   if(s.freshness!=='server'||!s.cards)return;
   surface(s.cards.map(x=>({id:x.id,count:x.confirmedCount})));
   state.version=s.version;
  }});
  controller.start();
  state.stop=()=>controller.stop();
 }
};
globalThis.r2ProbePrivate=async()=>{
 try { await getDocFromServer(doc(db,'arenaHomeLabPrivateCatalog','current'));return 'unexpected-readable'; }
 catch(e){return e.code;}
};
