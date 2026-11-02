(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function consistent(latest){
 if(!latest?.ok||!Array.isArray(latest.data?.players)||!Array.isArray(latest.publicData?.players))return false;
 const a=latest.data.players,b=latest.publicData.players,ids=new Set(b.map(p=>p.id));
 if(a.length!==b.length||ids.size!==b.length||!a.every(p=>b.some(q=>p.id===q.id&&p.name===q.name&&(p.checkedIn===true)===(q.checkedIn===true))))return false;
 const c=latest.counts;if(!c?.private||!c?.public||!['capacity','confirmedCount','waitlistCount'].every(k=>c.private[k]===c.public[k]))return false;
 return Number.isSafeInteger(latest.fences?.privateQr)&&latest.fences.privateQr>=1&&latest.fences.privateQr===latest.fences.publicQr&&latest.fences.privateQr===latest.data.qrCheckinRevision;
}
function currentStatus(latest,a){
 const d=a.data,players=latest.data.players||[],wait=latest.data.waitlistPlayers||[];
 const match=p=>d.registrationId?p.registrationId===d.registrationId:p.id===d.playerId;
 const p=players.filter(match),w=wait.filter(match);if(p.length>1||w.length>1||p.length&&w.length)return {valid:false};
 if(d.registrationId){
  const status=latest.registration?.status??null;
  return {valid:status==='confirmed'?p.length===1:status==='waitlist'?p.length===0:p.length===0&&w.length===0,status,player:p[0]||w[0]};
 }
 return {valid:true,status:p.length?'confirmed':w.length?'waitlist':null,player:p[0]||w[0]};
}
function create(ctx){
 const key='bxh-admin-roster:'+ctx.key;let busy=false,pending=null,corrupt=false;
 try{const raw=ctx.storage?.getItem(key);if(raw){pending=JSON.parse(raw);if(!pending?.data?.operationId||pending.actorUid!==ctx.actorUid)throw Error('invalid-pending');}}catch{corrupt=true;}
 const current=()=>ctx.current()&&ctx.allowed();
 function clear(){ctx.storage.removeItem(key);pending=null;}
 async function prepare(intent){
  if(!current()||busy||corrupt)throw Error('admin-roster-unavailable');if(pending)return clone(pending);
  busy=true;
  try{
   const preview=await ctx.call({action:'preview',code:ctx.code,roomId:ctx.roomId,...intent});
   if(!current())throw Error('room-context-changed');
   if(preview?.ok!==true||preview.code!==ctx.code||preview.roomId!==ctx.roomId||preview.operation!==intent.operation||
    preview.registrationId!==(intent.registrationId??null)||intent.playerId&&preview.playerId!==intent.playerId||
    typeof preview.signature!=='string'||!/^[a-f0-9]{64}$/.test(preview.signature)||typeof preview.name!=='string'||typeof preview.playerId!=='string'||!preview.playerId||
    !Array.isArray(preview.warnings)||preview.warnings.length>20||preview.warnings.some(w=>typeof w!=='string')||
    !Number.isSafeInteger(preview.expansion)||preview.expansion<0||preview.expansion%8!==0||typeof preview.resetBracket!=='boolean'||
    preview.from!==(intent.operation==='promote'?'waitlist':'confirmed')||preview.to!==(intent.operation==='promote'?'confirmed':'waitlist'))throw Error('invalid-preview');
   return {actorUid:ctx.actorUid,preview,data:{action:'commit',code:ctx.code,roomId:ctx.roomId,...intent,operationId:ctx.operationId(),expectedSignature:preview.signature,
    reason:'管理員已核對雲端選手、名額及配對影響，要求強制覆核正備取',confirmedAt:ctx.now(),allowExpansion:preview.expansion>0,allowBracketReset:preview.resetBracket}};
  }finally{busy=false;}
 }
 async function execute(approval){
  if(!current()||busy||corrupt)throw Error('admin-roster-unavailable');
  if(approval.actorUid!==ctx.actorUid||approval.data.code!==ctx.code||approval.data.roomId!==ctx.roomId)throw Error('room-context-changed');
  if(pending&&JSON.stringify({...pending.data,confirmedAt:0})!==JSON.stringify({...approval.data,confirmedAt:0}))throw Error('pending-operation-conflict');
  busy=true;
  try{
   if(!ctx.storage)throw Error('operation-storage-unavailable');pending=clone(approval);pending.data.confirmedAt=ctx.now();ctx.storage.setItem(key,JSON.stringify(pending));
   const a=clone(pending);let error;
   try{await ctx.call(a.data);}catch(e){error=e;}
   if(!current())throw Error('room-context-changed');let latest;
   for(let attempt=0;attempt<3;attempt++){
    latest=await ctx.read(a.data);
    if(!current())throw Error('room-context-changed');
    if(latest?.ok&&latest.data?.id===ctx.roomId){
     const record=latest.data.adminOperationOverrides?.find(r=>r.id===a.data.operationId&&r.actorUid===ctx.actorUid&&r.playerId===a.preview.playerId&&r.to===a.preview.to);
     const status=currentStatus(latest,a);
     if(record&&status.valid&&consistent(latest)){
      await ctx.adopt(latest,a);if(!current())throw Error('room-context-changed');clear();
      return {ok:true,superseded:status.status!==a.preview.to||!!status.player&&status.player.id!==a.preview.playerId,status:status.status,bracketReset:record.bracketReset};
     }
    }
    if(attempt<2)await ctx.wait(250*(attempt+1));
   }
   if(error?.code==='functions/failed-precondition'&&latest?.ok&&latest.data?.id===ctx.roomId&&
    !latest.data.adminOperationOverrides?.some(r=>r.id===a.data.operationId)){
    await ctx.adopt(latest,a);if(!current())throw Error('room-context-changed');clear();
   }
   throw error||Error('cloud-readback-unconfirmed');
  }finally{busy=false;}
 }
 return {prepare,execute,status:()=>({busy,corrupt,pending:pending?clone(pending):null})};
}
const api={create,consistent,currentStatus};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHAdminRoster=api;
})(typeof window==='object'?window:globalThis);
