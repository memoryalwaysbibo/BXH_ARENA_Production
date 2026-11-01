(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function consistent(f){
 const a=f?.data?.players,b=f?.publicData?.players,v=f?.versions,c=f?.counts;
 if(!f?.ok||!Array.isArray(a)||!Array.isArray(b)||!v||!c?.private||!c?.public||a.length!==b.length||new Set(b.map(p=>p.id)).size!==b.length)return false;
 if(!a.every(p=>b.some(q=>q.id===p.id&&q.name===(p.name||'')&&(q.checkedIn===true)===(p.checkedIn===true))))return false;
 if(!['capacity','confirmedCount','waitlistCount'].every(k=>c.private[k]===c.public[k])||!Number.isSafeInteger(c.private.confirmedCount)||!Number.isSafeInteger(c.private.waitlistCount))return false;
 if(![v.privateOwned,v.publicOwned,v.stateOwned,v.viewOwned].every(x=>x===true)||!Number.isSafeInteger(v.privateRuntime)||v.privateRuntime<1||![v.publicRuntime,v.stateRuntime,v.viewRuntime].every(x=>x===v.privateRuntime)||!Number.isSafeInteger(v.drawRevision)||v.drawRevision<1||v.drawRevision!==v.stateDrawRevision)return false;
 if(v.qrManaged)return v.publicQrManaged===true&&Number.isSafeInteger(v.privateQr)&&v.privateQr>=1&&v.privateQr===v.publicQr&&v.privateQr===f.data.qrCheckinRevision;
 return v.publicQrManaged!==true;
}
function create(ctx){
 const key='bxh-admin-onsite-recovery:'+ctx.key;let pending=null,busy=false,corrupt=false;
 try{const raw=ctx.storage?.getItem(key);if(raw){pending=JSON.parse(raw);if(!pending?.data?.operationId||!pending.preview||pending.actorUid!==ctx.actorUid)throw Error('invalid-pending');}}catch{pending=null;corrupt=true;}
 const current=()=>ctx.current()&&ctx.allowed();
 const clear=()=>{ctx.storage.removeItem(key);pending=null;};
 async function prepare(){
  if(!current()||busy||corrupt)throw Error('recovery-not-authorized');if(pending)return clone(pending);busy=true;
  try{
   const p=await ctx.call({action:'preview',code:ctx.code,roomId:ctx.roomId});if(!current())throw Error('room-context-changed');
   if(!p?.ok||p.code!==ctx.code||p.roomId!==ctx.roomId||typeof p.signature!=='string'||!/^[a-f0-9]{64}$/.test(p.signature)||typeof p.hasLock!=='boolean'||
    !Array.isArray(p.lockNames)||p.lockNames.some(n=>typeof n!=='string')||!Array.isArray(p.warnings)||p.warnings.some(w=>typeof w!=='string')||!Number.isSafeInteger(p.roundCount))throw Error('invalid-preview');
   return {actorUid:ctx.actorUid,preview:p,data:{action:'commit',code:ctx.code,roomId:ctx.roomId,operationId:ctx.operationId(),signature:p.signature,reason:'管理員已核對既有抽選紀錄與目前鎖定，確認同步／解鎖覆核',confirmedAt:ctx.now(),unlock:p.hasLock}};
  }finally{busy=false;}
 }
 async function execute(a){
  if(!current()||busy||corrupt)throw Error('recovery-not-authorized');if(a.actorUid!==ctx.actorUid||a.data.code!==ctx.code||a.data.roomId!==ctx.roomId)throw Error('room-context-changed');
  if(pending&&JSON.stringify({...pending.data,confirmedAt:0})!==JSON.stringify({...a.data,confirmedAt:0}))throw Error('pending-operation-conflict');busy=true;
  try{
   if(!ctx.storage)throw Error('storage-unavailable');pending=clone(a);pending.data.confirmedAt=ctx.now();ctx.storage.setItem(key,JSON.stringify(pending));const operation=clone(pending);let error;
   try{await ctx.call(operation.data);}catch(e){error=e;}if(!current())throw Error('room-context-changed');let latest;
   for(let i=0;i<3;i++){
    latest=await ctx.read(ctx.code);if(!current())throw Error('room-context-changed');
    if(latest?.ok&&latest.data?.id===ctx.roomId){const audit=latest.data.adminOperationOverrides?.find(r=>r.id===operation.data.operationId&&r.actorUid===ctx.actorUid&&r.operation==='onsite-reconcile');
     if(audit&&consistent(latest)){await ctx.adopt(latest);if(!current())throw Error('room-context-changed');clear();return {ok:true,superseded:latest.versions.drawRevision!==audit.drawRevisionAfter||latest.versions.privateRuntime!==audit.runtimeRevisionAfter,unlocked:audit.unlocked};}
    }
    if(i<2)await ctx.wait(250*(i+1));
   }
   if(error?.code==='functions/failed-precondition'&&latest?.ok&&latest.data?.id===ctx.roomId&&!latest.data.adminOperationOverrides?.some(r=>r.id===operation.data.operationId)){await ctx.adopt(latest);if(!current())throw Error('room-context-changed');clear();}
   throw error||Error('cloud-readback-unconfirmed');
  }finally{busy=false;}
 }
 return {prepare,execute,status:()=>({busy,corrupt,pending:pending?clone(pending):null})};
}
const api={create,consistent};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHAdminOnsiteRecovery=api;
})(typeof window==='object'?window:globalThis);
