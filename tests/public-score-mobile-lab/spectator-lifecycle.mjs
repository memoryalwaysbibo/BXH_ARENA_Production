// Isolated spectator-only ownership. Never invokes auth mutation, referee,
// registration, check-in, or database-wide disableNetwork/terminate.
import {createAdapter} from './spectator-adapter.mjs';
export function createSpectator({transport,validateView,onView,onClear,onStatus=()=>{}}){
 let generation=0,stopAccess=null,adapter=null,context=null;const cache=new Map();
 const key=c=>JSON.stringify([c.identity,c.room,c.epoch]);
 function stop(){generation++;stopAccess?.();stopAccess=null;adapter?.close();adapter=null;onClear();}
 function deny(g){if(g!==generation)return;cache.clear();stop();onStatus({state:'denied'});}
 async function setContext(next){
  const previous=context;context={...next};
  if(previous&&previous.identity!==next.identity)cache.clear();
  stop();const g=generation;
  if(next.route!=='spectator'||next.hidden||!next.room)return;
  const valid=()=>g===generation;
  try{
   // Fresh server authorization before any cached data is allowed on screen.
   await transport.authorize(next.room);if(!valid())return;
   stopAccess=transport.watchAccess(next.room,()=>deny(g),()=>deny(g));
   const cached=cache.get(key(next));if(cached)onView(structuredClone(cached),{source:'verified-cache',room:next.room});
   adapter=createAdapter({transport,validateView,onClear:()=>deny(g),onStatus:s=>{if(valid())onStatus(s);},onView:(view,meta)=>{
    if(!valid())return;validateView(view);cache.set(key(next),structuredClone(view));onView(view,meta);
   }});
   await adapter.open(next.room,next.epoch);
  }catch{deny(g);}
 }
 return {setContext,close(){cache.clear();stop();context=null;},clearCache(){cache.clear();},snapshot:()=>adapter?.snapshot()||null};
}
