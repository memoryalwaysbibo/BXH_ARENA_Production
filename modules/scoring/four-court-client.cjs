(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../../referee-seats/functions/bucket-state.cjs'));
 else root.BXHFourCourtClient=factory(root.BXHMatchBuckets);
})(typeof globalThis!=='undefined'?globalThis:this,function(B){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const uncertain=new Set(['cloud-unavailable','unavailable','deadline-exceeded']);
 function version(v){if(typeof v!=='string'||! /^(0|[1-9][0-9]*)$/.test(v))throw Error('invalid-room-version');return v;}
 const compare=(a,b)=>a.length-b.length||(a===b?0:a>b?1:-1);
 function create({transport,code,uid,onView=()=>{},operationId,canManage=()=>false}){
  if(!B||!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!uid||typeof operationId!=='function')throw Error('invalid-client');
  let rootRoom=null,base=null,manifest=null,rootVersion=null,state=null,status='offline',generation=0,bucketGeneration=0,roomStop=null,bucketStops=[],active=false,viewVersion=0,subscriptionFailed=false;
  const buckets=new Map(),pending=new Map();
  const retryable=()=>[...pending].filter(([,record])=>!record.running).map(([key])=>key);
  function emit(next,reason=null){status=next;onView({status,reason,state:state?clone(state):null,viewVersion:++viewVersion,pending:[...pending.keys()],retryable:retryable()});}
  function stopBuckets(){bucketGeneration++;for(const stop of bucketStops)stop();bucketStops=[];buckets.clear();}
  function assemble(){
   if(!active||!manifest)return;
   if(subscriptionFailed)return emit('error','subscription-unavailable');
   if(buckets.size!==manifest.bucketCount)return emit('syncing');
   try{
    const combined=B.materialize(base,manifest,[...buckets.values()]);
    combined.meta={...combined.meta,refereeSeatsV1:rootRoom.refereeSeatsV1,refereeSeatNames:rootRoom.refereeSeatNames||{},refereeStationAssignments:rootRoom.refereeStationAssignments||{},refereeStationNames:rootRoom.refereeStationNames||{},assignedStaffUids:rootRoom.assignedStaffUids||[]};
    state=combined;emit('ready');
   }catch(error){emit('syncing',error.message);}
  }
  function connect(){
   disconnect();active=true;subscriptionFailed=false;const token=generation;rootRoom=null;base=null;manifest=null;rootVersion=null;state=null;emit('syncing');
   roomStop=transport.watchRoom(code,event=>{
    if(!active||token!==generation||event.fromCache||event.pending)return;
    try{
     const nextVersion=version(event.version);if(rootVersion&&compare(nextVersion,rootVersion)<0)return;
     const nextRoom=clone(event.room),nextBase=JSON.parse(nextRoom.data),nextManifest=B.context(nextRoom,nextBase);
     if(nextManifest.code!==code)throw Error('room-mismatch');
     if(rootVersion===nextVersion&&JSON.stringify(nextRoom)!==JSON.stringify(rootRoom))throw Error('room-version-conflict');
     const reset=!manifest||nextManifest.epoch!==manifest.epoch||nextManifest.bucketCount!==manifest.bucketCount;
     rootRoom=nextRoom;base=nextBase;manifest=nextManifest;rootVersion=nextVersion;
     if(reset){
      stopBuckets();const bucketToken=bucketGeneration;emit('syncing');
      for(let i=1;i<=manifest.bucketCount;i++){
       const id='court-'+i;
       bucketStops.push(transport.watchBucket(code,id,event=>{
        if(!active||token!==generation||bucketToken!==bucketGeneration||event.fromCache||event.pending)return;
        const value=event.bucket;
        if(!value||value.bucketId!==id||value.epoch!==manifest.epoch){buckets.delete(id);return emit('syncing','bucket-context');}
        const previous=buckets.get(id);
        if(previous&&value.revision<previous.revision)return;
        if(previous&&value.revision===previous.revision&&JSON.stringify(value)!==JSON.stringify(previous)){subscriptionFailed=true;return emit('error','bucket-version-conflict');}
        buckets.set(id,clone(value));assemble();
       },()=>{if(active&&token===generation&&bucketToken===bucketGeneration){subscriptionFailed=true;emit('error','subscription-unavailable');}}));
      }
     }
     assemble();
    }catch(error){stopBuckets();manifest=null;emit('error',error.message);}
   },()=>{if(active&&token===generation){subscriptionFailed=true;emit('error','subscription-unavailable');}});
  }
  function disconnect(){active=false;generation++;roomStop?.();roomStop=null;stopBuckets();emit('offline');}
  const allowed=station=>!rootRoom?.systemClosed&&!rootRoom?.eventCancelled&&!rootRoom?.deletionStatus&&!['completed','archived'].includes(state?.archiveStatus)&&!['completed','archived'].includes(rootRoom?.archiveStatus)&&!state?.forcedCourtExits?.[station]?.closed&&(canManage(state,station)||['main','backup1','backup2'].some(slot=>state?.meta?.refereeSeatsV1?.courts?.[station]?.[slot]?.uid===uid));
  async function deliver(key,record){
   if(!active||status!=='ready')return {ok:false,reason:'not-synchronized'};
   if(record.epoch!==manifest.epoch){pending.delete(key);return {ok:false,reason:'generation-changed'};}
   if(record.running)return {ok:false,reason:'operation-pending'};
   record.running=true;pending.set(key,record);emit(status);
   try{
    const result=await (record.type==='score'?transport.commitScore:transport.manageSeats)(clone(record.data));
    if(result?.ok||result?.ok===false&&typeof result.reason==='string'&&!uncertain.has(result.reason))pending.delete(key);
    return result||{ok:false,reason:'cloud-unavailable'};
   }catch{return {ok:false,reason:'cloud-unavailable'};}
   finally{record.running=false;emit(status);}
  }
  async function score(matchId,action,extra={}){
   const key='score:'+matchId;
   if(pending.has(key))return {ok:false,reason:'operation-pending'};
   if(!active||status!=='ready')return {ok:false,reason:'not-synchronized'};
   const match=state.matches.find(m=>m.id===matchId),court=state.meta.refereeSeatsV1?.courts?.[match?.station];
   if(!match||!allowed(match.station))return {ok:false,reason:'station-not-assigned'};
   const data={...extra,code,operationId:operationId(),action,matchId,station:match.station,expectedCourtRevision:Number(court?.revision||0),expectedScoreRevision:Number(match.refereeSeatScoreRevision||0),expectedDispatchRevision:Number(match.dispatchRevision||0),playerAId:match.a?.playerId,playerBId:match.b?.playerId};
   return deliver(key,{type:'score',data,running:false,epoch:manifest.epoch});
  }
  function manageRefereeSeats(data){
   if(pending.has('seat'))return Promise.resolve({ok:false,reason:'operation-pending'});
   return deliver('seat',{type:'seat',data:{...data,code,operationId:data.operationId||operationId()},running:false,epoch:manifest?.epoch});
  }
  function retry(key){const record=pending.get(key);return record?deliver(key,record):Promise.resolve({ok:false,reason:'nothing-to-retry'});}
  return {connect,disconnect,score,manageRefereeSeats,retry,getView:()=>({status,state:state?clone(state):null,pending:[...pending.keys()],retryable:retryable()}),canScore:station=>status==='ready'&&allowed(station)};
 }
 return {create};
});
