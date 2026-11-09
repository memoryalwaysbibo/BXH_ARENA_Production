(function(root){
 'use strict';
 const labels={main:'主裁判',backup1:'備用裁判 1',backup2:'備用裁判 2'};
 const permissionDenied='目前帳號沒有這項邀請權限。';
 const managementHint='<p class="hint">裁判邀請的對象為一般玩家。BXH 工作人員與管理員請改用管理模式，從「賽事管理 → 其他分類 → 一般房間」開啟賽事，再進入裁判台。</p>';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let ctx,host=null,panel=null,epoch=0,entry=null,preview=null,entryBusy=false,entryError='',accepted=false,entryOp=null,entryActor='',actorGeneration=0,timer;
 const op=()=>root.crypto.randomUUID();
 function parseUrl(raw){try{
  const u=new URL(raw,root.location.href),p=new URLSearchParams(u.hash.slice(1));
  const code=p.get('referee'),requestId=p.get('invite'),qrToken=p.get('token');
  if(u.origin!==root.location.origin||!['http:','https:'].includes(u.protocol)||!/^BXH-[A-Z0-9]{4,16}$/.test(code||'')||!/^[-A-Za-z0-9]{1,80}$/.test(requestId||'')||!/^[A-Za-z0-9_-]{43}$/.test(qrToken||''))return null;
  return {code,requestId,qrToken};
 }catch{return null;}}
 function acceptUrl(raw){const next=parseUrl(raw);if(!next||entryBusy)return false;
  entry=next;preview=null;accepted=false;entryError='';entryOp=op();entryActor=ctx?.uid()||'';
  const u=new URL(root.location.href);u.search='';u.hash=new URLSearchParams({referee:next.code,invite:next.requestId,token:next.qrToken}).toString();
  root.history.replaceState(null,'',u.href);ctx?.render();return true;
 }
 function clearEntry(){entry=null;preview=null;entryError='';accepted=false;entryOp=null;const u=new URL(root.location.href);if(new URLSearchParams(u.hash.slice(1)).has('referee')){u.hash='';root.history.replaceState(null,'',u.href);}}
 function errorText(error){const raw=String(error?.message||error||'');
  for(const [code,text] of Object.entries({'community-result-available':'比賽已有結果','qr-expired':'邀請 QR 已失效，請房主重新顯示。','invalid-qr':'邀請 QR 無效，請重新掃描。','seat-stale':'席位已變更，請重新選擇。','request-pending':'這個席位已有邀請等待確認。','already-seated':'您已在本台擔任裁判。','permission-denied':permissionDenied,'target-ineligible':'這位玩家目前無法接受裁判邀請。','room-read-only':'賽事目前不開放裁判異動。'}))if(raw.includes(code))return text;
  return '尚未確認完成，請重試；重試會沿用原操作。';
 }
 async function call(data,operationId=op()){
  const result=await root.cloudSync?.manageRefereeSeats?.({...data,operationId});
  if(!result?.ok)throw Error(result?.reason||'cloud-unavailable');return result;
 }
 function close(){epoch++;clearTimeout(timer);panel?.remove();panel=null;host=null;}
 function hostCurrent(h){return host===h&&h.uid===ctx?.uid()&&h.code===ctx?.state()?.cloudCode&&ctx?.inviter?.();}
 function showHost(h,body){if(!hostCurrent(h))return;
  panel?.remove();panel=document.createElement('div');panel.className='ref-seat-overlay';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','邀請裁判');
  panel.innerHTML='<div class="ref-seat-dialog"><h2>邀請裁判</h2><p>'+esc(h.base.station)+' 號台｜'+esc(labels[h.base.slot])+'</p>'+body+'<button type="button" class="btn btn-ghost" data-ref-invite="close">取消</button></div>';
  panel.addEventListener('keydown',e=>{const items=[...panel.querySelectorAll('button:not(:disabled),input')];if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'&&items.length){e.preventDefault();items[(items.indexOf(document.activeElement)+(e.shiftKey?-1:1)+items.length)%items.length].focus();}});
  document.body.append(panel);panel.querySelector('input,button')?.focus();
 }
 function options(h){showHost(h,'<button type="button" class="btn btn-primary" data-ref-invite="name">名字邀請</button><button type="button" class="btn btn-primary" data-ref-invite="qr">顯示 QR 邀請</button>'+managementHint);}
 function nameForm(h,message=''){showHost(h,'<label for="ref-invite-name">玩家名字或遊戲 ID</label><input id="ref-invite-name" type="text" maxlength="80" autocomplete="off" placeholder="輸入完整名字或遊戲 ID"><p class="hint">同名玩家請核對遊戲 ID 後再選擇。</p>'+(message?'<p role="status">'+esc(message)+'</p>':'')+'<button type="button" class="btn btn-primary" data-ref-invite="search">搜尋玩家</button>'+managementHint);}
 async function search(h){const query=panel?.querySelector('input')?.value.trim();if(!query||query.length<1)return;
  const n=++epoch;showHost(h,'<p role="status">正在搜尋玩家…</p>');
  try{const r=await call({...h.base,code:h.code,action:'find-invite-player',query});if(n!==epoch||!hostCurrent(h))return;
   if(!r.players?.length)return nameForm(h,'找不到符合邀請資格的玩家。若對方是一般玩家，請核對完整遊戲 ID 或改用 QR 邀請。');
   h.players=r.players;showHost(h,r.players.map((p,i)=>'<button type="button" class="btn btn-primary" data-ref-invite="choose" data-index="'+i+'">'+esc(p.name)+'｜'+esc(p.gameId||'未設定遊戲 ID')+'</button>').join('')+'<button type="button" class="btn btn-ghost" data-ref-invite="name">重新搜尋</button>');
  }catch(e){if(n===epoch)nameForm(h,errorText(e));}
 }
 async function invite(h){const n=++epoch;showHost(h,'<p role="status">正在發出裁判邀請…</p>');
  try{await call({...h.base,code:h.code,action:'invite',targetUid:h.player.uid},h.inviteOp);if(n!==epoch||!hostCurrent(h))return;close();ctx.toast('已發出裁判邀請，請對方查看站內信。');ctx.render();}
  catch(e){if(n===epoch)showHost(h,'<p role="alert">'+esc(errorText(e))+'</p><button type="button" class="btn btn-primary" data-ref-invite="invite">重試原邀請</button>');}
 }
 async function qr(h){const n=++epoch;h.qrOp=h.qrOp||op();showHost(h,'<p role="status">正在建立邀請 QR…</p>');
  try{const r=await call({...h.base,code:h.code,action:'create-qr'},h.qrOp);if(n!==epoch||!hostCurrent(h))return;
   const u=new URL(root.location.href);u.search='';u.hash=new URLSearchParams({referee:h.code,invite:r.requestId,token:r.qrToken}).toString();
   showHost(h,'<div id="ref-invite-qr" class="ref-invite-qr"></div><p>請玩家掃碼後確認加入。此 QR 限一位玩家使用，5 分鐘內有效。</p>');
   ctx.qr('ref-invite-qr',u.href,240);
   timer=setTimeout(()=>{if(hostCurrent(h))showHost(h,'<p>邀請 QR 已到期，請重新選擇席位產生。</p>');},Math.max(0,r.expiresAt-Date.now()));
  }catch(e){if(n===epoch)showHost(h,'<p role="alert">'+esc(errorText(e))+'</p><button type="button" class="btn btn-primary" data-ref-invite="qr">重試建立 QR</button>');}
 }
 function open(base){close();if(!ctx?.inviter?.()||!ctx.uid()||!ctx.state()?.cloudCode)return;
  host={base,uid:ctx.uid(),code:ctx.state().cloudCode};options(host);
 }
 function bind(next){ctx=next;
  if(host&&!hostCurrent(host))close();
  if(!entry)entry=parseUrl(root.location.href);
  const uid=ctx.uid()||'';
  if(uid!==entryActor){actorGeneration++;entryActor=uid;preview=null;entryBusy=false;entryError='';accepted=false;entryOp=op();epoch++;close();}
 }
 async function inspect(){if(!entry||!ctx.uid()||entryBusy)return;const e=entry,actor=ctx.uid(),generation=actorGeneration;entryBusy=true;entryError='';ctx.render();
  try{const r=await call({...e,action:'inspect-qr'});if(entry===e&&ctx.uid()===actor&&generation===actorGeneration)preview=r;}
  catch(error){if(entry===e&&ctx.uid()===actor&&generation===actorGeneration){entryError=errorText(error);if(entryError==='比賽已有結果')preview=null;}}
  finally{if(entry===e&&ctx.uid()===actor&&generation===actorGeneration){entryBusy=false;ctx.render();}}
 }
 async function accept(){if(!entry||!ctx.uid()||entryBusy||!preview)return;const e=entry,actor=ctx.uid(),generation=actorGeneration;entryBusy=true;entryError='';ctx.render();
  try{
   if(!accepted){await call({...e,action:'accept-qr'},entryOp||(entryOp=op()));if(entry!==e||ctx.uid()!==actor||generation!==actorGeneration)return;accepted=true;}
   // Clear the URL intent while joining so the normal referee screen can render.
   const station=preview.station;clearEntry();
   try{await ctx.open(e.code,station);}catch(error){if(ctx.uid()===actor&&generation===actorGeneration){entry=e;preview={station};accepted=true;throw error;}}
  }catch(error){if(ctx.uid()===actor&&generation===actorGeneration){entryError=errorText(error);if(entryError==='比賽已有結果')preview=null;}}
  finally{if(ctx.uid()===actor&&generation===actorGeneration){entryBusy=false;ctx.render();}}
 }
 function renderEntry(){if(!entry||!ctx?.uid())return '';
  return '<section class="panel" aria-live="polite"><h2>裁判邀請</h2>'+(entryError?'<p role="alert">'+esc(entryError)+'</p>':'')+(entryError===permissionDenied?managementHint:'')+(entryBusy?'<p>正在確認邀請…</p>':preview?'<p>'+esc(entry.code)+'｜'+esc(preview.station)+' 號台｜'+esc(labels[preview.slot]||'裁判席')+'</p><p>確認以目前登入帳號加入裁判？</p><button class="btn btn-primary" data-ref-invite="accept">'+(accepted?'進入裁判台':'確認加入')+'</button>':entryError==='比賽已有結果'?'':'<p>先確認邀請的台號與席位，再決定是否加入。</p><button class="btn btn-primary" data-ref-invite="inspect">讀取邀請</button>')+'<button class="btn btn-ghost" data-ref-invite="dismiss" '+(entryBusy?'disabled':'')+'>'+(entryError==='比賽已有結果'?'確認':'取消')+'</button></section>';
 }
 document.addEventListener('click',event=>{const b=event.target.closest?.('[data-ref-invite]');if(!b||b.disabled)return;event.preventDefault();event.stopImmediatePropagation();const action=b.dataset.refInvite,h=host;
  if(action==='dismiss'){clearEntry();ctx.render();return;}
  if(action==='inspect'){inspect();return;}if(action==='accept'){accept();return;}if(action==='close'){close();return;}
  if(!h||!hostCurrent(h))return;
  if(action==='name')nameForm(h);if(action==='search')search(h);if(action==='qr')qr(h);if(action==='invite')invite(h);
  if(action==='choose'){h.player=h.players[Number(b.dataset.index)];if(!h.player)return;h.inviteOp=op();showHost(h,'<p>邀請 '+esc(h.player.name)+'（'+esc(h.player.gameId)+'）擔任本席裁判？</p><button type="button" class="btn btn-primary" data-ref-invite="invite">確認發出邀請</button>');}
 },true);
 root.BXHCommunityRefereeInvite={bind,open,parseUrl,acceptUrl,renderEntry};
})(window);
