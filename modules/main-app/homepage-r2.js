/* Official R2 homepage reader. Release switch requires an independently reviewed change. */
(function(root){
'use strict';
const ENABLED=true;
const validVersion=v=>Number.isSafeInteger(v)&&v>=0;
const validID=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
const validCards=cards=>Array.isArray(cards)&&cards.length<=20&&cards.every(c=>c&&validID(c.id)&&typeof c.name==='string'&&c.visibility==='public')&&new Set(cards.map(c=>c.id)).size===cards.length;
function create({watch,read,notify,fallback,retryMs=2000}){
 let active=false,epoch=0,seq=0,state=null,observed=null,unsubscribe=null,timer=null,confirmed=false,privacyPending=false,attempts=0;
 const cancel=()=>{if(timer!==null)clearTimeout(timer);timer=null;};
 const publish=(cards,server)=>notify({cards,server,version:server?state?.version??null:null});
 function stop(){active=false;epoch++;seq++;cancel();const end=unsubscribe;unsubscribe=null;end?.();state=null;observed=null;confirmed=false;privacyPending=false;attempts=0;}
 function fail(){if(!active)return;stop();fallback();}
 function schedule(){cancel();if(active&&confirmed)timer=setTimeout(()=>refresh(),Math.min(30000,retryMs*2**Math.min(attempts++,4)));}
 async function refresh(){
  if(!active||!confirmed)return;
  cancel();const e=epoch,t=++seq,known=state?.version??null,minimum=observed;
  const live=()=>active&&e===epoch&&t===seq&&confirmed;
  try{
   const r=await read({mode:'page',knownVersion:known});if(!live())return;
   if(r?.kind==='pending'){privacyPending=true;state=null;publish([],false);schedule();return;}
   if(!validVersion(r?.version)||r.version<minimum){state=null;publish([],false);schedule();return;}
   let cards;
   if(r.kind==='unchanged'&&state?.version===r.version)cards=state.cards;
   else if(r.kind==='first'&&validCards(r.cards))cards=r.cards;
   else if(r.kind==='delta'&&state&&r.from===state.version&&validCards(r.upsert)&&Array.isArray(r.remove)&&r.remove.every(validID)&&Array.isArray(r.order)){
    const map=new Map(state.cards.map(c=>[c.id,c]));for(const id of r.remove)map.delete(id);for(const c of r.upsert)map.set(c.id,c);
    cards=r.order.map(id=>map.get(id));if(cards.length!==map.size||!validCards(cards))cards=null;
   }
   if(!cards){state=null;publish([],false);schedule();return;}
   state={version:r.version,cards};privacyPending=false;attempts=0;observed=Math.max(observed,r.version);publish(cards,true);
  }catch{if(live()){if(privacyPending){state=null;publish([],false);schedule();}else fail();}}
 }
 function signal(s){
  if(!active)return;
  if(s?.fromCache!==false||s?.hasPendingWrites!==false||!validVersion(s.version)){
   confirmed=false;seq++;cancel();state=null;publish([],false);return;
  }
  const reconnect=!confirmed;confirmed=true;
  if(observed!==null&&s.version<observed)return;
  // A withdrawal reset or missed versions cannot leave the prior cards visible.
  const changed=observed!==s.version;observed=s.version;
  if(state&&s.version!==state.version&&s.previous!==state.version){state=null;publish([],false);}
  if(reconnect||changed||!state)void refresh();
 }
 return {start(){if(active)return;active=true;epoch++;try{const off=watch(signal,fail);if(active)unsubscribe=off;else off?.();}catch{fail();}},stop,refresh,invalidate(){if(!active)return;state=null;publish([],false);void refresh();}};
}
function toLobbyItem(card){
 if(!card||!validID(card.id))throw Error('invalid R2 card');
 const {id,title,...fields}=card;const raw={...fields,code:id,name:fields.name||title,__r2Summary:true};
 if(typeof raw.startAt==='number'&&Number.isFinite(raw.startAt)){
  const when=new Date(raw.startAt+8*3600000).toISOString().slice(0,16).split('T');raw.eventDate=when[0];raw.startAt=when[1];
 }
 return raw;
}
const api=Object.freeze({enabled:ENABLED,create,toLobbyItem});
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHHomepageR2=api;
})(typeof window==='undefined'?globalThis:window);
