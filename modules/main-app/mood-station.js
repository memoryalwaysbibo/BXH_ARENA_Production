// Core Phase 2B — Mood Station feature module.
// Context, rendering, service actions, input listeners and refresh lifecycle stay together.
function moodContext(){
 const key=currentAuthUid()+':'+engagementSessionEpoch;
 if(!moodState||moodState.key!==key)moodState={key,revision:0,messages:null,loading:false,busy:false,open:false,expanded:false,paused:false,text:'',operationId:null,error:'',canModerate:false,replyOpen:{},replyDrafts:{},replyOps:{},menuKey:null};
 return moodState;
}
function moodLength(text){return [...new Intl.Segmenter('zh-Hant',{granularity:'grapheme'}).segment(String(text||'').normalize('NFKC').trim())].length;}
function moodError(e){
 const message=String(e?.message||'');
 const errors={
  'text-length':'留言與回覆請輸入 1～30 字。',
  'blocked-text':'內容含有不適合公開的字詞，請調整後再送出。',
  'no-links':'心情小棧不開放連結或電子郵件，請改成短留言。',
  'invalid-text':'請使用單行文字，並移除隱藏字元。',
  'daily-limit':'今天已發布 10 則，台灣時間 00:00 後可再留言。',
  'cooldown':'每則留言至少間隔 60 秒，請稍後再試。',
  'reply-limit':'今天的回覆次數已達上限，台灣時間 00:00 後可再回覆。',
  'reply-cooldown':'回覆間隔至少 15 秒，請稍後再試。',
  'reply-full':'這則留言的回覆已達上限。',
  'message-unavailable':'這則留言已下架或超過 24 小時。',
  'account-inactive':'此帳號目前無法留言。',
  'not-owner':'只能刪除自己的內容。',
  'login-required':'請先登入後再留言。'
 };
 for(const[key,value]of Object.entries(errors))if(message.includes(key))return value;
 return '心情小棧暫時無法連線，請稍後重試。';
}

function moodReplyDraft(c,id){return String(c.replyDrafts?.[id]||'');}
function moodMenuHtml(c,key,action,id,replyId,label){
 if(c.menuKey!==key)return '';
 const replyAttr=replyId?` data-reply-id="${esc(replyId)}"`:'';
 return `<div class="mood-menu"><button class="btn btn-ghost btn-sm" data-action="${action}" data-message-id="${esc(id)}"${replyAttr} ${c.busy?'disabled':''}>${esc(label)}</button></div>`;
}
function renderMoodReplies(m,c){
 const replies=Array.isArray(m.replies)?m.replies:[];
 if(!c.replyOpen?.[m.id])return '';
 const rows=replies.length?replies.map(r=>{
  const key='reply:'+m.id+':'+r.id;
  return `<div class="mood-reply">
   <div class="mood-reply-row">
    <div class="mood-reply-body"><div class="mood-reply-line"><b>${esc(r.name)}</b>：${esc(r.text)}</div><small class="mood-reply-time">${esc(moodTime(r.createdAt))}</small></div>
    ${r.isOwn||c.canModerate?`<div class="mood-more-wrap"><button class="mood-more" data-action="mood-reply-menu-toggle" data-message-id="${esc(m.id)}" data-reply-id="${esc(r.id)}" aria-label="回覆管理" aria-expanded="${c.menuKey===key}" ${c.busy?'disabled':''}>⋯</button>${moodMenuHtml(c,key,'mood-remove-reply',m.id,r.id,r.isOwn?'刪除回覆':'下架回覆')}</div>`:''}
   </div>
  </div>`;
 }).join(''):'<p class="hint">目前還沒有回覆。</p>';
 const draft=moodReplyDraft(c,m.id);
 return `<div class="mood-replies" id="mood-replies-${esc(m.id)}">
  ${rows}
  <div class="mood-reply-compose">
   <input maxlength="300" data-mood-reply-id="${esc(m.id)}" value="${esc(draft)}" placeholder="回覆這則留言…" ${c.busy?'disabled':''}>
   <button class="btn btn-primary btn-sm" data-action="mood-reply-post" data-message-id="${esc(m.id)}" ${c.busy?'disabled':''}>送出</button>
   <div class="hint mood-reply-hint"><span id="mood-reply-count-${esc(m.id)}">${moodLength(draft)}</span>／30 字｜單層回覆，不進入上方跑馬燈。</div>
  </div>
 </div>`;
}
function renderMoodMessage(m,c){
 const replies=Array.isArray(m.replies)?m.replies:[];
 const open=!!c.replyOpen?.[m.id],menuKey='message:'+m.id;
 const heartCount=Number(m.heartCount||0),replyCount=Number(m.replyCount??replies.length);
 return `<div class="mood-message">
  <div class="mood-message-main">
   <div class="mood-message-line"><b>${esc(m.name)}</b>：${esc(m.text)}</div>
   <small class="mood-message-time">${esc(moodTime(m.createdAt))}</small>
   <div class="mood-actions">
    <button class="mood-action ${m.heartedByMe?'active':''}" data-action="mood-heart" data-message-id="${esc(m.id)}" aria-pressed="${!!m.heartedByMe}" aria-label="${m.heartedByMe?'取消愛心':'送出愛心'}" ${c.busy?'disabled':''}>❤️ ${heartCount}</button>
    <button class="mood-action" data-action="mood-replies-toggle" data-message-id="${esc(m.id)}" aria-expanded="${open}" aria-controls="mood-replies-${esc(m.id)}" ${c.busy?'disabled':''}>💬 回覆 ${replyCount} ${open?'⌃':'⌄'}</button>
    ${m.isOwn||c.canModerate?`<div class="mood-more-wrap"><button class="mood-more" data-action="mood-menu-toggle" data-message-id="${esc(m.id)}" aria-label="留言管理" aria-expanded="${c.menuKey===menuKey}" ${c.busy?'disabled':''}>⋯</button>${moodMenuHtml(c,menuKey,'mood-remove',m.id,'',m.isOwn?'刪除留言':'下架留言')}</div>`:''}
   </div>
  </div>
  ${renderMoodReplies(m,c)}
 </div>`;
}
async function loadMood(){
 const c=moodContext();if(!firebaseUser?.uid||c.busy){c.loading=false;return;}
 c.loading=true;const revision=c.revision;
 try{const r=await window.engagementService.mood({action:'list'});if(c!==moodContext()||revision!==c.revision)return;if(!r?.ok)throw Error('load-failed');c.messages=r.messages||[];c.canModerate=r.canModerate===true;c.error='';}
 catch(e){if(c===moodContext()&&revision===c.revision)c.error=moodError(e);}
 finally{if(c===moodContext()){c.loading=false;render();}}
}
function renderMoodStation(){
 if(!firebaseUser?.uid||guestReadOnlyMode)return '';
 const c=moodContext();
 if(c.messages===null&&!c.loading&&!c.error){c.loading=true;setTimeout(loadMood,0);}
 const items=(c.messages||[]).filter(m=>Number(m.createdAt)>Date.now()-86400000);
 const carousel=items.filter(m=>m.inCarousel!==false);
 const group=carousel.map(m=>`<span class="mood-item"><b>${esc(m.name)}</b>：${esc(m.text)}</span>`).join('');
 return `<section class="panel mood-station" aria-label="心情小棧">
 <div class="mood-head"><b>☕ 心情小棧</b><div class="btn-row"><button class="btn btn-ghost btn-sm" data-action="mood-expand" aria-expanded="${!!c.expanded}" aria-controls="mood-all">${c.expanded?'收合留言 ▴':'查看全部留言 ▾'}</button><button class="btn btn-primary btn-sm" data-action="mood-open" ${c.busy?'disabled':''}>${c.open?'收合':'我有話要說'}</button></div></div>
 ${renderRaffleAnnouncements()}
 <div class="mood-window" role="button" tabindex="0" aria-pressed="${c.paused}" aria-label="按住暫停玩家留言，放開繼續"><div class="mood-track ${c.paused?'paused':''}">${items.length?`<div class="mood-group">${group}</div><div class="mood-group" aria-hidden="true">${group}</div>`:`<span>${c.loading?'正在載入心情…':'今天想說什麼？分享你的陀螺心情。'}</span>`}</div></div>
 ${c.expanded?`<div id="mood-all" class="mood-list" style="max-height:360px;overflow-y:auto"><p class="hint">近 24 小時留言・最新在上｜❤️ 共鳴・💬 單層回覆</p>${items.length?items.map(m=>renderMoodMessage(m,c)).join(''):'<p class="hint">目前沒有留言。</p>'}</div>`:''}
 ${c.error?`<p class="hint" role="status">${esc(c.error)} <button class="btn btn-ghost btn-sm" data-action="mood-refresh" ${c.loading||c.busy?'disabled':''}>重試</button></p>`:''}
 ${c.open?`<div class="mood-compose"><label for="mood-text">我有話要說</label><input id="mood-text" maxlength="300" value="${esc(c.text)}" placeholder="寫下 1～30 字的小心情" ${c.busy?'disabled':''}><div class="hint"><span id="mood-count">${moodLength(c.text)}</span>／30 字｜每人每天 10 則，台灣時間 00:00 重置；間隔 60 秒，展示 24 小時。刪除不退還次數。</div><div class="btn-row"><button class="btn btn-primary" data-action="mood-post" ${c.busy?'disabled':''}>${c.busy?'處理中…':'發布留言'}</button><button class="btn btn-ghost" data-action="mood-cancel" ${c.busy?'disabled':''}>取消</button></div></div>`:''}</section>`;
}
async function handleMood(action,target){
 const c=moodContext();if(!firebaseUser?.uid||guestReadOnlyMode)return;
 const id=String(target?.getAttribute?.('data-message-id')||'');
 if(action==='mood-expand'){c.expanded=!c.expanded;c.menuKey=null;render();return;}
 if(action==='mood-open'){c.open=!c.open;c.menuKey=null;render();return;}
 if(action==='mood-cancel'){c.open=false;c.text='';c.operationId=null;c.error='';render();return;}
 if(action==='mood-refresh'){if(!c.loading&&!c.busy)loadMood();return;}
 if(action==='mood-replies-toggle'){
  c.replyOpen={...(c.replyOpen||{}),[id]:!c.replyOpen?.[id]};c.menuKey=null;render();return;
 }
 if(action==='mood-menu-toggle'){const key='message:'+id;c.menuKey=c.menuKey===key?null:key;render();return;}
 if(action==='mood-reply-menu-toggle'){
  const replyId=String(target?.getAttribute?.('data-reply-id')||''),key='reply:'+id+':'+replyId;
  c.menuKey=c.menuKey===key?null:key;render();return;
 }
 if(c.busy)return;
 let payload;
 if(action==='mood-post'){
  if(moodLength(c.text)<1||moodLength(c.text)>30){c.error='留言請輸入 1～30 字。';render();return;}
  c.operationId=c.operationId||crypto.randomUUID();payload={action:'post',text:c.text,operationId:c.operationId};
 }else if(action==='mood-remove')payload={action:'remove',id};
 else if(action==='mood-heart')payload={action:'heart',id};
 else if(action==='mood-reply-post'){
  const draft=moodReplyDraft(c,id);
  if(moodLength(draft)<1||moodLength(draft)>30){c.error='回覆請輸入 1～30 字。';render();return;}
  c.replyOps=c.replyOps||{};c.replyOps[id]=c.replyOps[id]||crypto.randomUUID();
  payload={action:'reply',id,text:draft,operationId:c.replyOps[id]};
 }else if(action==='mood-remove-reply'){
  payload={action:'remove-reply',id,replyId:String(target?.getAttribute?.('data-reply-id')||'')};
 }else return;
 c.revision++;c.busy=true;c.error='';c.menuKey=null;render();
 try{
  const r=await window.engagementService.mood(payload);if(c!==moodContext())return;if(!r?.ok)throw Error('write-failed');
  c.messages=r.messages||[];c.canModerate=r.canModerate===true;
  if(action==='mood-post'){c.text='';c.operationId=null;c.open=false;}
  if(action==='mood-reply-post'){c.replyDrafts={...(c.replyDrafts||{}),[id]:''};if(c.replyOps)delete c.replyOps[id];c.replyOpen={...(c.replyOpen||{}),[id]:true};}
  if(action==='mood-post')showToast('心情已發布');
  else if(action==='mood-reply-post')showToast('回覆已送出');
  else if(action==='mood-remove-reply')showToast('回覆已移除');
  else if(action==='mood-remove')showToast('留言已移除');
 }catch(e){if(c===moodContext())c.error=moodError(e);}
 finally{if(c===moodContext()){c.busy=false;render();}}
}
let moodHeldPointer=null;
function setMoodHeld(held){
 const c=moodContext();c.paused=held;
 const viewport=document.querySelector('.mood-window');
 viewport?.querySelector('.mood-track')?.classList.toggle('paused',held);
 viewport?.setAttribute('aria-pressed',String(held));
}
function releaseMoodHold(){moodHeldPointer=null;setMoodHeld(false);}
document.addEventListener('pointerdown',e=>{
 if(e.button!==0||!e.target?.closest?.('.mood-window'))return;
 moodHeldPointer=e.pointerId;setMoodHeld(true);
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{if(e.pointerId===moodHeldPointer)releaseMoodHold();});
document.addEventListener('pointerout',e=>{const viewport=e.target?.closest?.('.mood-window');if(viewport&&e.pointerId===moodHeldPointer&&!viewport.contains(e.relatedTarget))releaseMoodHold();});
document.addEventListener('keydown',e=>{if(e.target?.matches('.mood-window')&&['Enter',' '].includes(e.key)){e.preventDefault();setMoodHeld(true);}});
document.addEventListener('keyup',e=>{if(['Enter',' '].includes(e.key)&&moodState?.paused)releaseMoodHold();});
document.addEventListener('focusout',e=>{if(e.target?.matches('.mood-window'))releaseMoodHold();});
window.addEventListener('blur',releaseMoodHold);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseMoodHold();});
document.addEventListener('input',e=>{
 if(e.target?.id==='mood-text'){
  const c=moodContext();c.text=e.target.value;c.operationId=null;const count=document.getElementById('mood-count');if(count)count.textContent=moodLength(c.text);return;
 }
 const replyId=e.target?.getAttribute?.('data-mood-reply-id');
 if(replyId){
  const c=moodContext();c.replyDrafts={...(c.replyDrafts||{}),[replyId]:e.target.value};if(c.replyOps)delete c.replyOps[replyId];
  const count=document.getElementById('mood-reply-count-'+replyId);if(count)count.textContent=moodLength(e.target.value);
 }
});
setInterval(()=>{if(appPhase==='player-center'&&playerActiveTab==='home'&&firebaseUser?.uid&&!guestReadOnlyMode){const c=moodContext();if(!c.loading&&!c.busy)loadMood();}},60000);

Object.assign(window.BXHMoodFeature||(window.BXHMoodFeature={}),{moodContext,moodLength,moodError,moodReplyDraft,moodMenuHtml,renderMoodReplies,renderMoodMessage,loadMood,renderMoodStation,handleMood,setMoodHeld,releaseMoodHold});
