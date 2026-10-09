/* Production host seam. Firebase authentication is supplied by cloudSync only. */
(function(global){
 'use strict';
 let active=null;
 function beforeRender(){if(active)active.focus=active.root.contains(document.activeElement)?document.activeElement:null;}
 const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function placeholder({code,actorId}){
   if(!code||!actorId||!global.BXHOnsiteWaitlistDraw)return '';
   return '<div id="bxh-onsite-waitlist-root" data-code="'+escapeHTML(code)+'" data-actor-id="'+escapeHTML(actorId)+'"></div>';
 }
 const pendingKey=(code,actorId)=>'bxh.onsite-waitlist.host-pending.v1:'+encodeURIComponent(actorId)+':'+encodeURIComponent(code);
 const inFlight=new Set();
 function pendingCommand(code,actorId){
   try{const body=JSON.parse(global.localStorage.getItem(pendingKey(code,actorId))||'null');return body?.code===code&&body.action==='checkIn'&&typeof body.operationId==='string'?body:null;}catch(_){return null;}
 }
 async function command({code,actorId,isCurrent,api},action,extra,retry=false){
   const key=pendingKey(code,actorId);
   const fail=code=>{throw Object.assign(new Error(code),{code});};
   if(!isCurrent())fail('room-context-changed');
   if(inFlight.has(key))fail('operation-in-progress');
   inFlight.add(key);
   try{
     let body=pendingCommand(code,actorId);
     if(body&&!retry)fail('operation-pending');
     if(!body){
       if(retry)fail('no-pending-operation');
       if(action!=='checkIn')fail('invalid-operation');
       const result=await api({code,action:'preview'});
       if(!isCurrent())fail('room-context-changed');
       body=Object.assign({code,action,operationId:global.crypto.randomUUID(),expectedRevision:result.state.revision},extra);
       try{const value=JSON.stringify(body);global.localStorage.setItem(key,value);if(global.localStorage.getItem(key)!==value)fail('storage-unavailable');}catch(_){fail('storage-unavailable');}
     }
     try{
       const result=await api(body);
       global.localStorage.removeItem(key);
       return result;
     }catch(e){
       // Only a definitive server rejection clears the retry token. Network,
       // auth/session interruption and unknown outcomes keep the original ID.
       if(e.definitive===true||['stale-revision','invalid-operation','invalid-participant','not-confirmed','bracket-locked','permission-denied','event-feature-disabled','checkin-closed'].includes(e.code))global.localStorage.removeItem(key);
       throw e;
     }
   }finally{inFlight.delete(key);}
 }
 function dispose(){if(active){active.handle?.destroy();active=null;}}
 function bind(config){
   const placeholder=document.getElementById('bxh-onsite-waitlist-root');
   if(!config?.enabled||!placeholder||!config.isCurrent()||typeof config.api!=='function'){dispose();return;}
   const code=placeholder.dataset.code,actorId=placeholder.dataset.actorId;
   if(active&&active.code===code&&active.actorId===actorId){
     // The app rebuilds its outer HTML on realtime updates. Retain this exact
     // subtree, listeners, selection draft and open result across that rebuild.
     if(placeholder!==active.root)placeholder.replaceWith(active.root);
     active.config=config;
     if(active.focus?.isConnected&&!active.focus.disabled)active.focus.focus({preventScroll:true});
     active.focus=null;
     if(Number(config.revision)>Number(active.handle.getState()?.revision||0))active.handle.refresh();
     return;
   }
   dispose();
   const context={root:placeholder,code,actorId,config,handle:null};active=context;
   const isCurrent=()=>active===context&&context.root.isConnected&&context.config.isCurrent();
   context.handle=global.BXHOnsiteWaitlistDraw.mount(placeholder,{
     enabled:true,allowConfigure:true,code,actorId,
     api:data=>{if(!isCurrent())throw Object.assign(new Error('room-context-changed'),{code:'room-context-changed'});return context.config.api(data);},
     onRosterCommitted:async result=>{if(isCurrent())await context.config.onCommitted(result,{code,actorId});},
   });
 }
 global.BXHOnsiteWaitlistIntegration=Object.freeze({placeholder,bind,dispose,beforeRender,command,pendingCommand});
})(window);
