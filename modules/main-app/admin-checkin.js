(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function create(ctx){
 const key='bxh-admin-checkin:'+ctx.key;let busy=false,pending=null,corrupt=false;
 try{const raw=ctx.storage?.getItem(key);if(raw){pending=JSON.parse(raw);if(!pending?.data?.operationId||pending.actorUid!==ctx.actorUid)throw Error('invalid-pending-operation');}}catch{corrupt=true;}
 const current=()=>ctx.current()&&ctx.allowed();
 function persist(){if(!ctx.storage)throw Error('operation-storage-unavailable');ctx.storage.setItem(key,JSON.stringify(pending));}
 function clear(){ctx.storage.removeItem(key);pending=null;}
 function prepare(player,reason){
  if(!current()||busy||corrupt)throw Error('admin-checkin-unavailable');
  if(pending)return clone(pending);
  const data={code:ctx.code,roomId:ctx.roomId,playerId:player.id,checkedIn:player.checkedIn!==true,expectedCheckedIn:player.checkedIn===true,
   operationId:ctx.operationId(),reason,confirmedAt:ctx.now()};
  return {actorUid:ctx.actorUid,name:player.name,data};
 }
 async function execute(approval){
  if(!current()||busy||corrupt)throw Error('admin-checkin-unavailable');
  if(approval.actorUid!==ctx.actorUid||approval.data.code!==ctx.code||approval.data.roomId!==ctx.roomId)throw Error('room-context-changed');
  if(pending&&JSON.stringify({...pending.data,confirmedAt:0})!==JSON.stringify({...approval.data,confirmedAt:0}))throw Error('pending-operation-conflict');
  busy=true;
  try{
   pending=clone(approval);pending.data.confirmedAt=ctx.now();persist();
   const operation=clone(pending);let error;
   try{await ctx.call(operation.data);}catch(e){error=e;}
   if(!current())throw Error('room-context-changed');
   let latest;
   for(let attempt=0;attempt<3;attempt++){
    latest=await ctx.read(ctx.code);
    if(!current())throw Error('room-context-changed');
    if(latest?.ok&&latest.data?.id===ctx.roomId){
     const record=latest.data.adminOperationOverrides?.find(r=>r.id===operation.data.operationId&&r.actorUid===ctx.actorUid&&r.playerId===operation.data.playerId&&r.checkedIn===operation.data.checkedIn);
     const a=latest.data.players?.find(p=>p.id===operation.data.playerId),b=latest.publicData?.players?.find(p=>p.id===operation.data.playerId);
     if(record&&((a&&b&&(a.checkedIn===true)===(b.checkedIn===true))||(!a&&!b))){
      const superseded=!a||(a.checkedIn===true)!==operation.data.checkedIn;
      await ctx.adopt(latest.data);if(!current())throw Error('room-context-changed');clear();
      return {ok:true,superseded,checkedIn:a?.checkedIn===true};
     }
    }
    if(attempt<2)await ctx.wait(250*(attempt+1));
   }
   // An explicit backend rejection ends this attempt. Network/unknown outcomes
   // retain the same durable ID so retry cannot duplicate or reverse a change.
   if(error?.code==='functions/failed-precondition'&&latest?.ok&&latest.data?.id===ctx.roomId&&
     !latest.data.adminOperationOverrides?.some(r=>r.id===operation.data.operationId))clear();
   throw error||Error('cloud-readback-unconfirmed');
  }finally{busy=false;}
 }
 return {prepare,execute,status:()=>({busy,corrupt,pending:pending?clone(pending):null})};
}
const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHAdminCheckin=api;
})(typeof window==='object'?window:globalThis);
