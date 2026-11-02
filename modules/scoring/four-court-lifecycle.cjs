(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('./four-court-session.cjs'));
 else root.BXHFourCourtLifecycle=factory(root.BXHFourCourtSession);
})(typeof globalThis!=='undefined'?globalThis:this,function(Session){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 function create({enabled=false,auth,authApi,sessionOptions={},ensureAppCheck=async()=>{},onStatus=()=>{},sessionFactory=options=>Session.create(options),timeoutMs=8000}){
  const markers=new Map(),listeners=new Set();let active=null,generation=0,disposed=false,resumeContext=null;
  const current=entry=>!disposed&&active===entry&&entry.generation===generation&&auth.currentUser?.uid===entry.uid;
  function status(entry,view){if(active!==entry)return;entry.view=view;onStatus({code:entry.code,uid:entry.uid,status:view.status,reason:view.reason||null,clear:view.state===null});for(const check of [...entry.waiters])check();}
  function stop(){const entry=active;if(!entry)return;active=null;generation++;clearTimeout(entry.idle);entry.session?.stop();for(const check of [...entry.waiters])check();}
  function fail(entry,reason){if(active!==entry)return;entry.session?.stop();entry.session=null;status(entry,{status:'error',reason,state:null});}
  function observe(code,manifest){
   if(disposed)return;
   if(!manifest){markers.delete(code);if(active?.code===code)stop();return;}
   markers.set(code,clone(manifest));
   const uid=auth.currentUser?.uid;
   if(active?.code===code&&active.epoch===manifest.epoch&&active.uid===uid)return;
   stop();const entry={code,epoch:manifest.epoch,manifest:clone(manifest),uid,generation:++generation,session:null,host:{cloudSync:{}},view:null,waiters:new Set()};active=entry;
   status(entry,{status:'syncing',state:null});
   if(enabled!==true)return fail(entry,'bucket-client-disabled');
   if(!uid)return fail(entry,'auth-required');
   if(manifest.schema!=='bxh-match-buckets-v1'||manifest.status!=='active'||manifest.code!==code||typeof manifest.epoch!=='string'||!manifest.epoch)return fail(entry,'bucket-not-ready');
   // App Check setup may finish after a room switch or sign-out. No stale start.
   Promise.resolve().then(()=>ensureAppCheck()).then(()=>{
    if(!current(entry))return;
    const session=sessionFactory({...sessionOptions,enabled:true,auth,authApi,code,
     onState:state=>{
      if(!current(entry))return;
      const composed={...state,scoreStorage:clone(entry.manifest)};
      entry.state=composed;
      for(const listener of [...listeners])if(listener.code===code)listener.callback(clone(composed),true);
      for(const check of [...entry.waiters])check();
     },
     onView:view=>{if(current(entry))status(entry,view);}
    });
    if(!current(entry)){session.stop();return;}entry.session=session;session.start(entry.host);
   }).catch(()=>{if(current(entry))fail(entry,'bucket-session-unavailable');});
  }
  const stopAuth=authApi.onAuthStateChanged(auth,user=>{
   if(active&&user?.uid!==active.uid){const entry=active;fail(entry,'auth-changed');stop();}
  });
  function subscribe(code,callback,{primary=true}={}){
   const listener={code,callback,primary};listeners.add(listener);if(active?.code===code){clearTimeout(active.idle);const entry=active;if(entry.state&&entry.view?.status==='ready')queueMicrotask(()=>{if(listeners.has(listener)&&current(entry)&&entry.view?.status==='ready')callback(clone(entry.state),true);});}
   return ()=>{listeners.delete(listener);if(active?.code===code&&![...listeners].some(x=>x.code===code&&x.primary))stop();};
  }
  async function read(code,manifest){
   if(active&&active.code!==code){
    const preview=create({enabled,auth,authApi,sessionOptions,ensureAppCheck,sessionFactory,timeoutMs});
    try{return await preview.read(code,manifest);}finally{preview.dispose();}
   }
   if(active?.code===code&&active.view?.status==='error'){
    if(active.session?.client.getView().pending?.length)return {ok:false,reason:'bucket-operation-unresolved'};
    stop();
   }
   observe(code,manifest);const entry=active;
   if(!entry||entry.code!==code)return {ok:false,reason:'not-synchronized'};
   const result=await new Promise(resolve=>{
    let timer;const finish=value=>{clearTimeout(timer);entry.waiters.delete(check);resolve(value);};
    const check=()=>{if(!current(entry))return finish({ok:false,reason:'bucket-session-mismatch'});if(entry.view?.status==='error')return finish({ok:false,reason:entry.view.reason});if(entry.state&&entry.view?.status==='ready')finish({ok:true,data:clone(entry.state)});};
    timer=setTimeout(()=>finish({ok:false,reason:'not-synchronized'}),timeoutMs);entry.waiters.add(check);check();
   });
   if(active===entry&&![...listeners].some(x=>x.code===code)){clearTimeout(entry.idle);entry.idle=setTimeout(()=>{if(active===entry)stop();},5000);}
   return result;
  }
  async function command(data,method){
   const entry=active;
   if(!entry||entry.code!==data.code||!current(entry))return {ok:false,reason:'bucket-session-mismatch'};
   if(entry.view?.status!=='ready'||!entry.session)return {ok:false,reason:entry.view?.reason||'not-synchronized'};
   const result=await entry.host.cloudSync[method](data);
   if(!current(entry))return {ok:false,reason:'bucket-session-mismatch'};
   return result?.state?{...result,state:{...result.state,scoreStorage:clone(entry.manifest)}}:result;
  }
  return {observe,subscribe,read,command,isBucket:code=>markers.has(code),view:code=>active?.code===code?active.view:null,
   reconnect(code){const entry=active;if(!entry||entry.code!==code||!current(entry)||!entry.session)return {ok:false,reason:'bucket-session-mismatch'};entry.session.client.connect();return {ok:true};},
   suspend(){resumeContext=active?{code:active.code,uid:active.uid}:null;if(active?.session)active.session.client.disconnect();else stop();},
   resume(){const context=resumeContext;resumeContext=null;if(context&&auth.currentUser?.uid===context.uid&&[...listeners].some(x=>x.code===context.code&&x.primary)){if(active?.code===context.code&&active.session)active.session.client.connect();else observe(context.code,markers.get(context.code));}},
   dispose(){if(disposed)return;stop();disposed=true;stopAuth();listeners.clear();markers.clear();}};
 }
 return {create};
});
