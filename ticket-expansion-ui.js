/* Explicit owner-confirmed standby expansion. Prices/capacity come from server. */
(function(root){
'use strict';
const active=new Set();
const permanent=/ticket-expansion-not-ready|ticket-owner-required|ticket-host-unavailable|ticket-binding-invalid|ticket-expired|ticket-capacity-invalid|ticket-room-invalid|ticket-expansion-limit|expansion-payment-required|expansion-quote-changed|not-waitlist|already-confirmed|bracket-locked|permission-denied|operation-conflict|registration-state-conflict|corrupt-state|duplicate-player|invalid-/;
const messages={
 'ticket-expansion-not-ready':'票券房擴充功能尚未開放，請聯絡 BXH。',
 'ticket-expansion-limit':'已超過此券的臨時擴充上限，請聯絡 BXH 申請。',
 'expansion-payment-required':'尚有待補繳擴充費，請先完成繳款。',
 'expansion-quote-changed':'名單、容量或帳款已變更，請重新確認報價。',
 'ticket-host-unavailable':'目前主辦資格無法使用，請聯絡 BXH。',
 'ticket-expired':'這張票券已過期，請聯絡 BXH。',
 'bracket-locked':'賽事已進入編排或開賽階段，無法再升正取。'
};
function errorText(e){const raw=String(e?.message||e||'');for(const [k,v]of Object.entries(messages))if(raw.includes(k))return v;return permanent.test(raw)?'資料已變更或目前無法操作，請同步名單後再試。':'連線結果尚未確認。請再次按升正取，核對原操作；不會重新建立加購。';}
async function promote(ctx,selected){
 const key='bxh.ticket-expansion.v1:'+ctx.uid+':'+ctx.code;
 if(active.has(key)||!ctx.isCurrent())return;
 active.add(key);ctx.busy(true);
 const call=async payload=>{
  if(!root.engagementService?.commerce)throw Error('ticket-expansion-not-ready');
  const r=await root.engagementService.commerce(payload);if(!r?.ok)throw Error(r?.error||'request-failed');return r;
 };
 async function commit(payload){
  if(active.has(key)||!ctx.isCurrent())return;
  active.add(key);ctx.busy(true);
  try{
   // Fail closed if we cannot preserve the exact accepted intent across reloads.
   sessionStorage.setItem(key,JSON.stringify({uid:ctx.uid,code:ctx.code,payload}));
   const r=await call(payload);
   sessionStorage.removeItem(key);
   if(ctx.isCurrent())await ctx.apply(r,r.replayed?'原操作已完成，已同步最新名單。':r.amountTwd?'已加購 '+r.additionalSeats+' 個名額並升正取；待補繳 NT$ '+r.amountTwd+'。':'已升為正取，本次無加購費用。');
  }catch(e){
   if(permanent.test(String(e?.message||e)))try{sessionStorage.removeItem(key);}catch{}
   if(ctx.isCurrent())ctx.error(errorText(e));
  }finally{active.delete(key);if(ctx.isCurrent())ctx.busy(false);}
 }
 try{
  let pending;try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{throw Error('storage-unavailable');}
  if(pending){
   if(pending.uid!==ctx.uid||pending.code!==ctx.code||pending.payload?.action!=='ticket-confirm-promotion')throw Error('storage-unavailable');
   ctx.modal({type:'generic',title:'核對上一筆升正取操作',message:'上一筆操作的連線結果尚待確認。請先核對原操作，再進行其他加購。',confirmLabel:'核對原操作',onConfirm:()=>commit(pending.payload)});return;
  }
  const response=await call({action:'ticket-quote-promotion',code:ctx.code,selected});
  if(!ctx.isCurrent())return;
  const q=response.quote;
  if(!q||q.ownerUid!==ctx.uid||q.code!==ctx.code||!Array.isArray(q.selected)||!Number.isSafeInteger(q.amountTwd)||q.amountTwd<0||typeof q.hash!=='string')throw Error('invalid-quote');
  const payload={action:'ticket-confirm-promotion',code:ctx.code,selected:q.selected,quoteHash:q.hash,accepted:true,operationId:crypto.randomUUID()};
  if(q.amountTwd===0){active.delete(key);await commit(payload);return;}
  ctx.modal({type:'generic',title:'加購名額並升正取',
   message:'將增加 '+q.additionalSeats+' 個正取名額，每名額 NT$ '+q.unitPriceTwd+'，本次費用 NT$ '+q.amountTwd+'。\n\n正取上限：'+q.fromCapacity+' → '+q.toCapacity+' 人\n\n確認後列入待補繳，請於賽事結束後 7 天內繳清；下一次購券或啟動賽事前須先結清。',
   confirmLabel:'確認加購並升正取',onConfirm:()=>commit(payload)});
 }catch(e){if(ctx.isCurrent())ctx.error(errorText(e));}
 finally{active.delete(key);if(ctx.isCurrent())ctx.busy(false);}
}
root.BXHTicketExpansion={promote,errorText};
})(window);
