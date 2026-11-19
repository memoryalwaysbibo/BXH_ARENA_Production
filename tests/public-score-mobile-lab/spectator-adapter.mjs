// LAB ONLY. No Firebase paths, credentials or production subscription integration.
const CONTROL=new Set(['courtAssignments','forcedCourtExits','callRevision','courtLifecycleEpoch','championId','runnerUpId','thirdId','fourthId','gfMatchId','gfResetMatchId','bronzeMatchId','rrRounds','updatedAt']);
const canonical=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
async function hash(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function createAdapter({transport,onView,validateView,onClear=()=>{},onStatus=()=>{}}){
 if(typeof validateView!=='function')throw Error('public-schema-validator-required');
 let generation=0,stopDelta=null,stopLegacy=null,current=null,room=null,epoch=null;
 const cleanup=()=>{stopDelta?.();stopLegacy?.();stopDelta=stopLegacy=null;};
 async function open(nextRoom,nextEpoch){
  const g=++generation;cleanup();room=nextRoom;epoch=nextEpoch;current=null;
  let buffer=[],booting=true,chain=Promise.resolve(),failed=false;
  const active=()=>g===generation;
  async function apply(p){
   if(!active())return;
   if(p.schema!==1||p.epoch!==nextEpoch||!Number.isSafeInteger(p.revision)||p.revision<0)throw Error('invalid-version');
   // Old replay frames are ignored only against an installed newer checkpoint.
   if(current&&p.revision<current.revision)return;
   if(current&&p.revision===current.revision){if(p.hash!==current.hash)throw Error('conflicting-revision');return;}
   let view;
   if(p.type==='checkpoint')view=structuredClone(p.view);
   else{
    if(p.type!=='delta'||!current||p.baseRevision!==current.revision||p.revision!==current.revision+1||p.baseHash!==current.hash)throw Error('gap');
    if(Object.keys(p.set).some(k=>!CONTROL.has(k)))throw Error('non-public-control');
    const changed=new Map(p.matches.map(m=>[m.id,m]));
    if(changed.size!==p.matches.length||[...changed.keys()].some(id=>!current.view.matches.some(m=>m.id===id)))throw Error('invalid-match-ids');
    view=structuredClone(current.view);view.matches=view.matches.map(m=>structuredClone(changed.get(m.id)||m));Object.assign(view,structuredClone(p.set));
   }
   validateView(view);
   if(!Array.isArray(view.matches)||new Set(view.matches.map(m=>m.id)).size!==view.matches.length||view.matches.some(m=>typeof m.id!=='string'||!m.id)||await hash(view)!==p.hash)throw Error('invalid-view');
   if(!active())return;
   current={revision:p.revision,hash:p.hash,view};onView(structuredClone(view),{room:nextRoom,revision:p.revision,source:'delta'});
  }
  const fallback=error=>{
   if(!active()||failed)return;
   if(['permission-denied','unauthenticated'].includes(error?.code)||String(error).includes('not-found')){
    failed=true;cleanup();current=null;onClear();onStatus({state:'denied',room:nextRoom});return;
   }
   failed=true;stopDelta?.();stopDelta=null;
   if(!stopLegacy)stopLegacy=transport.legacy(nextRoom,v=>{if(active()){validateView(v);onView(v,{room:nextRoom,source:'legacy'});}},error=>{if(active()){cleanup();current=null;onClear();onStatus({state:'denied',room:nextRoom});}});
   onStatus({state:'fallback',room:nextRoom,reason:String(error)});
  };
  stopLegacy=transport.legacy(nextRoom,v=>{if(active()&&booting){validateView(v);onView(v,{room:nextRoom,source:'legacy'});}},fallback);
  onStatus({state:'connecting',room:nextRoom});
  try{
   const subscription=transport.subscribe(nextRoom,p=>{
    if(!active()||failed)return;
    if(booting){buffer.push(p);if(buffer.length>256)fallback('buffer-overflow');}
    else chain=chain.then(()=>apply(p)).catch(fallback);
   },fallback);
   stopDelta=subscription.stop;
   await subscription.ready;if(!active()||failed)return;
   const checkpoint=await transport.checkpoint(nextRoom);if(!active()||failed)return;
   await apply(checkpoint);
   while(buffer.length&&active()&&!failed){const batch=buffer;buffer=[];for(const p of batch)if(p.revision>checkpoint.revision)await apply(p);}
   if(!active()||failed)return;
   booting=false;stopLegacy?.();stopLegacy=null;
   onStatus({state:'live',room:nextRoom,revision:current.revision});
  }catch(error){fallback(error);}
 }
 return {open,reconnect:()=>open(room,epoch),close(){generation++;cleanup();current=null;},snapshot:()=>structuredClone(current)};
}
export function httpTransport(){
 function stream(room,kind,onPacket,onError=()=>{}){
  const es=new EventSource('/'+kind+'?room='+encodeURIComponent(room));
  let resolve,reject,opened=false;const ready=new Promise((r,j)=>{resolve=r;reject=j;});
  es.onopen=()=>{opened=true;resolve();};es.onmessage=e=>{try{onPacket(JSON.parse(e.data));}catch(err){onError(err);}};
  es.onerror=()=>{if(!opened)reject(Error('stream-open-failed'));onError(Error('stream-disconnected'));};
  return {ready,stop:()=>es.close()};
 }
 return {subscribe:(room,cb,err)=>stream(room,'delta',cb,err),legacy:(room,cb)=>{const s=stream(room,'legacy',cb);s.ready.catch(()=>{});return s.stop;},checkpoint:async room=>{const r=await fetch('/checkpoint?room='+encodeURIComponent(room),{cache:'no-store'});if(!r.ok)throw Error('checkpoint-failed');return r.json();}};
}
