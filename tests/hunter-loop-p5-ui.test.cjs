'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'raffle-ui.js'),'utf8');
function has(text,msg){if(!source.includes(text))throw new Error(msg);}
function before(a,b,msg){const ia=source.indexOf(a),ib=source.indexOf(b);if(ia<0||ib<0||ia>=ib)throw new Error(msg);}
has("function openRaffleJoinConfirm(preview,event)","P5 join confirmation dialog missing");
has("action:'joinPreview'","P5 server-side join preview call missing");
has("ticketRequirements","P5 ticket requirement preview missing");
has("ticketCharges","P5 ticket charge preview missing");
has("目前可用：","P5 ticket availability display missing");
has("審核通過時，系統會重新核對票券","P5 manual-review deferred charge explanation missing");
has("若交易失敗不會扣券","P5 atomic failure explanation missing");
has("data-raffle-join-confirm=\"yes\"","P5 explicit join confirm button missing");
has("data-raffle-join-confirm=\"no\"","P5 explicit cancel button missing");
has("dialog.addEventListener('cancel',event=>{event.preventDefault();done(false);});","P5 ESC/back cancel must resolve false");
has("if(!approved)return;","P5 cancelled dialog must stop before join");
has("ticketConfirmation:preview.confirmationToken","P5 confirmed join must bind the exact preview token");
has("await raffleMutate({action:'join'","P5 confirmed join mutation missing");
has("const sensitive=!!(payload?.password||payload?.config?.joinPassword);","Join password must remain excluded from session persistence");
has("'unsupported-ticket-policy':'活動票券規格需要更新","P5 unsupported policy user message missing");
has("'ticket-confirmation-stale':'票券狀態已變更","P5 stale confirmation user message missing");
before("preview=await window.engagementService.raffle({action:'joinPreview'","await raffleMutate({action:'join'","P5 preview must occur before the write call");
if(source.includes("join:'確認參加？如採用消耗票券條件"))throw new Error('Legacy generic ticket confirmation must be removed');
console.log('PASS HUNTER LOOP P5 frontend join preview / explicit confirmation guards');
