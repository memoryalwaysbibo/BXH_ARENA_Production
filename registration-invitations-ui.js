(()=>{'use strict';
let callable=null,busy=false,attachmentBusy=false,lastMine=0,nextMineAt=0,mineFailures=0,lastMineUid='',lastCode='',lastSentHtml='',lastSentAt=0,mineRows=[];
const mailboxDraft={initialized:false,open:false,targetUid:'',subject:'',body:'',lastMessageId:''};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function runtime(){try{return Function('return {user:firebaseUser,profile:userProfile,state:state,phase:appPhase,mailbox:(typeof mailboxContext==="function"?mailboxContext:null),entryUrl:(typeof buildTournamentEntryUrl==="function"?buildTournamentEntryUrl:null),render:(typeof render==="function"?render:null)}')()}catch{return {}}}
async function api(data){if(!callable){const [a,f]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js')]);callable=f.httpsCallable(f.getFunctions(a.getApp(),'asia-east1'),'registrationInvitations',{timeout:25000});}return (await callable(data)).data}
function code(){return String(runtime().state?.cloudCode||'').toUpperCase()}
function managerPanel(){
 const ta=document.getElementById('quick-add-textarea');if(!ta)return false;
 let box=document.getElementById('registration-invite-panel');
 if(box&&box.isConnected)return false;
 box=document.createElement('div');box.id='registration-invite-panel';box.className='panel';
 box.innerHTML='<div class="panel-title">搜尋會員並邀請</div><p class="hint">輸入完整玩家 ID、遊戲 ID 或本名。只有玩家接受後才會成立報名。</p><div class="btn-row"><input id="registration-invite-search" maxlength="60" placeholder="玩家 ID 或完整本名"><button class="btn btn-primary" data-invite="search">搜尋</button></div><div data-invite-results></div><div data-invite-sent></div>';
 const anchor=ta.closest('.field');if(!anchor)return false;anchor.before(box);lastSentHtml='';lastSentAt=0;loadSent(true);return true;
}
async function loadSent(force=false){const c=code(),host=document.querySelector('[data-invite-sent]');if(!c||!host||document.hidden)return;const now=Date.now();if(!force&&now-lastSentAt<30000)return;lastSentAt=now;try{const r=await api({action:'sent',code:c});if(!host.isConnected)return;const html=(r.rows||[]).length?'<h4>邀請狀態</h4>'+r.rows.map(x=>'<p>'+esc(x.targetName)+'｜'+({pending:'待玩家確認',accepted:'已接受',declined:'已拒絕',expired:'已逾期'}[x.status]||esc(x.status))+'</p>').join(''):'';if(html!==lastSentHtml){host.innerHTML=html;lastSentHtml=html}}catch(e){}}
async function search(){if(busy)return;const term=document.getElementById('registration-invite-search')?.value.trim(),c=code(),host=document.querySelector('[data-invite-results]');if(!term||!c||!host)return;busy=true;host.textContent='搜尋中…';try{const r=await api({action:'search',code:c,term});host.innerHTML=(r.rows||[]).map(x=>'<div class="ap-task"><b>'+esc(x.displayName)+'</b><small>'+esc(x.playerId||'尚無玩家編號')+'</small><button class="btn btn-primary btn-sm" data-invite="send" data-uid="'+esc(x.uid)+'">發送邀請</button></div>').join('')||'<p class="hint">找不到完全符合的會員；請確認 ID／本名，或改用現場臨時玩家。</p>'}catch(e){host.textContent='搜尋失敗：'+String(e?.message||e?.code||'unknown')}finally{busy=false}}
async function send(uid){if(busy)return;busy=true;try{await api({action:'invite',code:code(),targetUid:uid});alert('邀請已送出；名單將顯示待玩家確認。');await loadSent(true)}catch(e){alert('邀請失敗：'+String(e?.message||e?.code||'unknown'))}finally{busy=false}}
function inviteOverlay(rows){let el=document.getElementById('registration-invitation-overlay');if(!rows.length){el?.remove();return}if(!el){el=document.createElement('div');el.id='registration-invitation-overlay';document.body.appendChild(el)}el.innerHTML='<section class="panel"><div class="panel-title">賽事參加邀請</div>'+rows.map(x=>'<div class="ap-task"><b>'+esc(x.eventName)+'</b><p>'+esc(x.invitedByName)+' 邀請你參加</p><div class="btn-row"><button class="btn btn-primary" data-invite="accept" data-code="'+esc(x.code)+'">接受</button><button class="btn btn-danger" data-invite="decline" data-code="'+esc(x.code)+'">拒絕</button></div></div>').join('')+'</section>'}
function updateBroadcastMode(){
 const toggle=document.getElementById('mailbox-broadcast-mode'),recipient=document.getElementById('mailbox-recipient')?.closest('.field'),button=document.querySelector('[data-action="mailbox-send-test"]'),warning=document.getElementById('mailbox-broadcast-warning'),on=!!toggle?.checked;
 if(recipient)recipient.hidden=on;if(button)button.textContent=on?'發送全站公告':'發送測試信';if(warning)warning.hidden=!on;
}
function broadcastComposer(){
 const rt=runtime(),profile=rt.profile,subject=document.getElementById('mailbox-subject');
 let box=document.getElementById('mailbox-broadcast-controls');
 if(profile?.role!=='super_admin'||!subject){box?.remove();return}
 const details=subject.closest('details'),recipient=document.getElementById('mailbox-recipient'),body=document.getElementById('mailbox-body');
 const sent=rt.mailbox?rt.mailbox()?.lastSent:null,messageId=String(sent?.messageId||'');
 if(messageId&&messageId!==mailboxDraft.lastMessageId){mailboxDraft.initialized=true;mailboxDraft.open=true;mailboxDraft.targetUid='';mailboxDraft.subject='';mailboxDraft.body='';mailboxDraft.lastMessageId=messageId}
 if(!mailboxDraft.initialized){mailboxDraft.initialized=true;mailboxDraft.open=!!details?.open;mailboxDraft.targetUid=recipient?.value||'';mailboxDraft.subject=subject.value||'';mailboxDraft.body=body?.value||''}
 if(details&&details.open!==mailboxDraft.open)details.open=mailboxDraft.open;
 if(recipient&&recipient.value!==mailboxDraft.targetUid)recipient.value=mailboxDraft.targetUid;
 if(subject.value!==mailboxDraft.subject)subject.value=mailboxDraft.subject;
 if(body&&body.value!==mailboxDraft.body)body.value=mailboxDraft.body;
 if(box?.isConnected)return;
 box=document.createElement('div');box.id='mailbox-broadcast-controls';box.style.margin='12px 0';
 box.innerHTML='<label style="display:flex;align-items:center;gap:10px"><input id="mailbox-broadcast-mode" type="checkbox" style="width:auto"> 公告模式（寄送給全部有效會員）</label><div id="mailbox-broadcast-warning" class="auth-error" hidden style="margin-top:10px">目前為全站公告模式。送出後，每位有效會員都會收到站內信，請再次確認標題與內容。</div>';
 const button=details?.querySelector('[data-action="mailbox-send-test"]');button?.before(box);
 box.querySelector('input').addEventListener('change',updateBroadcastMode);updateBroadcastMode();
}
document.addEventListener('input',e=>{if(e.target?.id==='mailbox-recipient')mailboxDraft.targetUid=e.target.value;else if(e.target?.id==='mailbox-subject')mailboxDraft.subject=e.target.value;else if(e.target?.id==='mailbox-body')mailboxDraft.body=e.target.value});
document.addEventListener('toggle',e=>{if(e.target?.querySelector?.('#mailbox-recipient'))mailboxDraft.open=e.target.open},true);
async function sendBroadcast(button){
 if(busy)return;const subject=document.getElementById('mailbox-subject')?.value.trim(),body=document.getElementById('mailbox-body')?.value.trim();
 if(!subject||!body){alert('請完整填寫公告標題與內容。');return}
 if(!confirm('這會將「'+subject+'」寄送給全部有效會員。確定繼續？'))return;
 if(!confirm('最後確認：全站公告送出後無法收回，確定發送？'))return;
 busy=true;button.disabled=true;const old=button.textContent;button.textContent='公告發送中…';
 try{const result=await window.engagementService.mailbox({action:'broadcast',subject,body,type:'announcement',operationId:crypto.randomUUID()});alert('全站公告已送出，共 '+Number(result?.sentCount||0)+' 位會員收到。');document.getElementById('mailbox-broadcast-mode').checked=false;updateBroadcastMode()}
 catch(e){alert('公告發送失敗：'+String(e?.message||e?.code||'unknown'))}
 finally{busy=false;button.disabled=false;button.textContent=old;updateBroadcastMode()}
}
async function sendSingle(button){
 if(busy)return;const targetUid=mailboxDraft.targetUid.trim(),subject=mailboxDraft.subject.trim(),body=mailboxDraft.body.trim();
 if(!targetUid||!subject||!body){alert('請完整填寫玩家 UID、標題與內容。');return}
 if(!confirm('確認發送「'+subject+'」給指定玩家？'))return;
 busy=true;button.disabled=true;const old=button.textContent;button.textContent='寄送中…';
 try{
  const result=await window.engagementService.mailbox({action:'send',targetUid,subject,body,type:'test',operationId:crypto.randomUUID()});
  if(!result?.ok)throw Error('operation-failed');
  const rt=runtime(),ctx=rt.mailbox?rt.mailbox():null;
  if(ctx){ctx.lastSent={targetUid,messageId:result.messageId};ctx.messages=null}
  mailboxDraft.open=true;mailboxDraft.targetUid='';mailboxDraft.subject='';mailboxDraft.body='';mailboxDraft.lastMessageId=String(result.messageId||'');
  if(rt.render)rt.render();alert(result.replayed?'這封測試信先前已送出':'測試信已送出');
 }catch(e){alert('測試信寄送失敗：'+String(e?.message||e?.code||'unknown'))}
 finally{busy=false;button.disabled=false;button.textContent=old;broadcastComposer()}
}
function stableAttachmentPanel(){
 const rt=runtime(),ctx=rt.mailbox?rt.mailbox():null,selected=(ctx?.messages||[]).find(x=>x.id===ctx.selectedId);
 const sent=ctx?.lastSent||(selected?.type==='test'&&rt.user?.uid?{targetUid:rt.user.uid,messageId:selected.id}:null);
 let panel=document.getElementById('mailbox-stable-attachment');
 if(!sent?.targetUid||!sent?.messageId){panel?.remove();return}
 if(panel?.dataset.messageId===String(sent.messageId))return;
 panel?.remove();panel=document.createElement('section');panel.id='mailbox-stable-attachment';panel.dataset.messageId=String(sent.messageId);panel.className='panel';
 panel.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2600;width:min(420px,calc(100vw - 36px));box-shadow:0 18px 60px #000a';
 panel.innerHTML='<strong>為剛寄出的信件新增附件</strong><p class="hint">PDF、PNG、JPG、TXT，單檔最多 2 MB</p><input id="mailbox-stable-attachment-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"><div class="btn-row" style="margin-top:10px"><button class="btn btn-primary btn-sm" data-mailbox-stable-upload>上傳附件</button><button class="btn btn-ghost btn-sm" data-mailbox-stable-close>稍後處理</button></div>';
 document.body.appendChild(panel);
 panel.querySelector('[data-mailbox-stable-close]').addEventListener('click',()=>panel.remove());
 panel.querySelector('[data-mailbox-stable-upload]').addEventListener('click',async()=>{
  if(attachmentBusy)return;const file=panel.querySelector('input[type="file"]')?.files?.[0];if(!file){alert('請先選擇附件');return}
  const mime=({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain'})[file.name.split('.').pop().toLowerCase()]||file.type;
  if(file.size<1||file.size>2*1024*1024||!['application/pdf','image/png','image/jpeg','text/plain'].includes(mime)){alert('僅支援 PDF、PNG、JPG、TXT，單檔最多 2 MB');return}
  attachmentBusy=true;const button=panel.querySelector('[data-mailbox-stable-upload]');button.disabled=true;button.textContent='上傳中…';
  try{
   const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('file-read-failed'));reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(file)});
   const result=await window.engagementService.mailboxAttachment({action:'upload',targetUid:sent.targetUid,messageId:sent.messageId,operationId:crypto.randomUUID(),name:file.name,mime,base64});
   if(!result?.ok)throw Error('attachment-upload-failed');panel.remove();alert('附件已加到該封站內信');
  }catch(e){alert('附件上傳失敗：'+String(e?.message||e?.code||'unknown'));button.disabled=false;button.textContent='上傳附件'}finally{attachmentBusy=false}
 });
}
document.addEventListener('click',e=>{const button=e.target.closest?.('[data-action="mailbox-send-test"]');if(!button)return;e.preventDefault();e.stopImmediatePropagation();if(document.getElementById('mailbox-broadcast-mode')?.checked)sendBroadcast(button);else sendSingle(button)},true);
function mailboxInvitationPanel(){
 const rt=runtime(),ctx=rt.mailbox?rt.mailbox():null,selected=(ctx?.messages||[]).find(x=>x.id===ctx.selectedId);
 let panel=document.getElementById('mailbox-invitation-actions');
 if(!selected||selected.type!=='tournament_invitation'||!selected.eventCode){panel?.remove();return}
 const article=document.querySelector('.mailbox-layout article.panel');if(!article)return;
 const c=String(selected.eventCode).toUpperCase(),pending=mineRows.find(x=>String(x.code).toUpperCase()===c);
 const raw=pending?'pending':(selected.invitationStatus||'pending');
 const label={pending:'等待你的確認',accepted:'已接受邀請',confirmed:'已接受邀請（正取）',waitlist:'已接受邀請（備取）',declined:'已拒絕邀請',expired:'邀請已逾期'}[raw]||esc(raw);
 const expires=pending?.expiresAt?new Date(pending.expiresAt).toLocaleString('zh-TW'):'';
 const html='<div class="panel-title">賽事邀請操作</div><p><b>'+esc(pending?.eventName||selected.eventName||selected.subject||'賽事')+'</b></p><p class="hint">房間代碼：'+esc(c)+(expires?'｜請於 '+esc(expires)+' 前回覆':'')+'</p><p data-invite-mail-status>狀態：'+label+'</p><div class="btn-row">'+(raw==='pending'?'<button class="btn btn-primary" data-invite="accept" data-code="'+esc(c)+'">接受邀請</button><button class="btn btn-danger" data-invite="decline" data-code="'+esc(c)+'">拒絕邀請</button>':'')+'<button class="btn btn-ghost" data-invite="open-event" data-code="'+esc(c)+'">查看賽事／前往報名處</button></div>';
 if(!panel){panel=document.createElement('div');panel.id='mailbox-invitation-actions';panel.className='panel';panel.style.marginTop='16px';article.appendChild(panel)}
 if(panel.dataset.content!==html){panel.innerHTML=html;panel.dataset.content=html}
}
async function mine(force=false){if(document.hidden&&!force)return;const r=runtime(),uid=r.user?.uid;if(!uid)return;if(uid!==lastMineUid){lastMineUid=uid;nextMineAt=0;mineFailures=0}const now=Date.now();if(!force&&now<nextMineAt)return;lastMine=now;try{const x=await api({action:'mine'});mineRows=x.rows||[];mineFailures=0;nextMineAt=Date.now()+60000;inviteOverlay(mineRows);mailboxInvitationPanel()}catch(e){mineFailures=Math.min(mineFailures+1,5);nextMineAt=Date.now()+Math.min(300000,30000*(2**(mineFailures-1)));console.warn('[registrationInvitations] mine failed; backing off',e)}}
async function respond(c,decision){if(busy)return;busy=true;try{const r=await api({action:'respond',code:c,decision});const rt=runtime(),ctx=rt.mailbox?rt.mailbox():null,selected=(ctx?.messages||[]).find(x=>x.id===ctx.selectedId);if(selected&&String(selected.eventCode).toUpperCase()===String(c).toUpperCase())selected.invitationStatus=decision==='accept'?(r.status||'accepted'):'declined';alert(decision==='accept'?'已接受邀請，報名狀態：'+(r.status==='confirmed'?'正取':r.status==='waitlist'?'備取':'已確認'):'已拒絕邀請');lastMine=0;nextMineAt=0;mineRows=mineRows.filter(x=>String(x.code).toUpperCase()!==String(c).toUpperCase());mailboxInvitationPanel();await mine(true)}catch(e){alert('處理邀請失敗：'+String(e?.message||e?.code||'unknown'))}finally{busy=false}}
document.addEventListener('click',e=>{const t=e.target.closest?.('[data-invite]');if(!t)return;const a=t.dataset.invite;if(a==='search')search();if(a==='send')send(t.dataset.uid);if(a==='accept'||a==='decline')respond(t.dataset.code,a);if(a==='open-event'){const rt=runtime(),url=rt.entryUrl?rt.entryUrl(t.dataset.code,'register'):('?code='+encodeURIComponent(t.dataset.code)+'&entry=register');window.location.assign(url)}});
const style=document.createElement('style');style.textContent='#registration-invitation-overlay{position:fixed;inset:0;z-index:2700;background:#000d;padding:18px;display:flex;align-items:center;justify-content:center}#registration-invitation-overlay>section{width:min(560px,100%);max-height:85dvh;overflow:auto}#registration-invite-panel input{min-width:0;flex:1}#registration-invite-panel [data-invite-results] .ap-task{display:flex;align-items:center;gap:10px;margin-top:10px}#registration-invite-panel [data-invite-results] small{color:#999;flex:1}';document.head.appendChild(style);
function tick(){if(document.hidden)return;const r=runtime(),c=code();if((r.phase==='tournament'||document.getElementById('quick-add-textarea'))&&c){if(c!==lastCode){lastCode=c;lastSentHtml='';lastSentAt=0}managerPanel();loadSent()}broadcastComposer();stableAttachmentPanel();mailboxInvitationPanel();mine()}
setInterval(tick,3000);setTimeout(tick,0);
new MutationObserver(()=>{broadcastComposer();stableAttachmentPanel()}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){nextMineAt=0;tick()}});
})();
