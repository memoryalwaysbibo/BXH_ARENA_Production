// Core Phase 2C — Card Album feature module.
// Album context, loading, rendering and trade workflow stay together.
function cardAlbumContext(){
 const uid=firebaseUser?.uid||"";
 if(cardAlbumState.uid!==uid)cardAlbumState={uid,data:null,loading:false,error:"",trades:null,targets:null,query:"",targetUid:"",busy:false};
 return cardAlbumState;
}
async function loadCardAlbum(refresh=false){
 const state=cardAlbumContext(),uid=state.uid;
 if(!uid||state.loading||(!refresh&&state.data))return;
 state.loading=true;state.error="";renderPreservingScroll();
 try{
  if(!window.engagementService?.cardAlbum)throw Error("卡冊服務尚未連線");
  const [data,trades]=await Promise.all([window.engagementService.cardAlbum({action:"get"}),window.engagementService.cardAlbum({action:"list"})]);
  if(cardAlbumContext().uid!==uid)return;
  state.data=data;state.trades=trades;state.error="";
 }catch(e){if(cardAlbumContext().uid===uid)state.error=String(e?.message||"卡冊暫時無法讀取").slice(0,130);}
 finally{if(cardAlbumContext().uid===uid){state.loading=false;renderPreservingScroll();}}
}
function cardAlbumImage(set,card){return set.assetRoot+card.id+set.extension;}
function renderCardAlbumPage(){
 const state=cardAlbumContext();
 if(!state.data&&!state.loading&&!state.error)setTimeout(()=>loadCardAlbum(),0);
 const sets=cardAlbumSetFilter==="all"?CARD_ALBUM_SETS:CARD_ALBUM_SETS.filter(set=>set.id===cardAlbumSetFilter);
 const rows=sets.map(set=>{
  const counts=state.data?.sets?.[set.id]||{};
  const total=CARD_ALBUM_CARDS.filter(card=>Number(counts[card.id])>0).length;
  return `<section class="panel card-album-set" aria-label="${esc(set.name)}">
    <div class="card-album-set-head"><h3>${esc(set.name)}</h3><span class="badge badge-metal">${state.data?`已擁有 ${total}/12`:"讀取收藏中"}</span></div>
    <div class="card-album-grid">${CARD_ALBUM_CARDS.map(card=>{
      const quantity=Math.max(0,Number(counts[card.id])||0),owned=!!state.data&&quantity>0;
      const src=cardAlbumImage(set,card),label=`${set.name} ${card.name}`;
      return owned?`<button type="button" class="card-album-slot owned" data-action="card-album-preview" data-set="${set.id}" data-card="${card.id}" aria-label="檢視 ${esc(label)}，持有 ${quantity} 張"><img loading="lazy" decoding="async" src="${src}" alt="${esc(label)}卡面"><span class="card-album-count">×${quantity}</span></button>`:
        `<div class="card-album-slot" aria-label="${esc(label)}，${state.data?"尚未擁有":"讀取中"}"><img loading="lazy" decoding="async" src="${src}" alt="${esc(label)}卡面"><div class="card-album-lock"><strong>${esc(card.name)}</strong>${state.data?"尚未擁有":"收藏狀態待確認"}</div></div>`;
    }).join("")}</div>
    <p class="hint">集滿 12 張自動解鎖稱號「${esc(set.title)}」。</p>
  </section>`;
 }).join("");
 const selected=cardAlbumPreview&&CARD_ALBUM_SETS.find(s=>s.id===cardAlbumPreview.set);
 const card=cardAlbumPreview&&CARD_ALBUM_CARDS.find(c=>c.id===cardAlbumPreview.card);
 const canPreview=selected&&card&&Number(state.data?.sets?.[selected.id]?.[card.id])>0;
 return `<section class="panel">
  <div class="card-album-head"><h2 class="panel-title">我的卡冊</h2><label>選擇套卡 <select id="card-album-set-filter" aria-label="選擇套卡"><option value="all" ${cardAlbumSetFilter==="all"?"selected":""}>全部</option>${CARD_ALBUM_SETS.map(set=>`<option value="${set.id}" ${cardAlbumSetFilter===set.id?"selected":""}>${esc(set.name)}</option>`).join("")}</select></label></div>
  <p class="hint card-album-note">基礎套卡為所有玩家的基本卡；諸神戰場目前發給工作人員以上。十月完成 BXH 官方賽事每場隨機獲得一張，第 12 場補齊缺卡。重複卡可與其他玩家互換。</p>
  ${state.error?`<div class="auth-error">卡冊讀取失敗：${esc(state.error)}</div>`:""}
  <button type="button" class="btn btn-ghost btn-sm" data-action="card-album-refresh" ${state.loading?"disabled":""}>${state.loading?"讀取中…":"更新收藏"}</button>
 </section>${rows}${state.data?renderCardAlbumTrade(state):""}
 ${canPreview?`<div class="modal-overlay card-album-preview-overlay" data-action="card-album-close"><div class="modal-box card-album-preview" role="dialog" aria-modal="true" aria-label="${esc(selected.name)} ${esc(card.name)}"><button type="button" class="btn btn-ghost btn-sm" data-action="card-album-close">關閉</button><img src="${cardAlbumImage(selected,card)}" alt="${esc(card.name)}完整卡面"><h3>${esc(selected.name)}｜${esc(card.name)}</h3><p>持有 ${Number(state.data.sets[selected.id][card.id])} 張</p></div></div>`:""}`;
}
function renderCardAlbumTrade(state){
 const counts=state.data?.sets?.gods||{},duplicates=CARD_ALBUM_CARDS.filter(c=>Number(counts[c.id])>=2),selected=state.targetUid;
 const target=state.targets?.find(x=>x.uid===selected);
 const incoming=state.trades?.incoming||[],outgoing=state.trades?.outgoing||[];
 return `<section class="panel card-album-trades"><h3>重複卡交換｜諸神戰場</h3><p class="hint">雙方都需有重複卡。發出邀請後，對方確認才會交換；邀請 7 天後失效。</p>
 <label>尋找玩家 <input id="card-album-query" value="${esc(state.query)}" placeholder="輸入玩家名稱或玩家 ID" maxlength="60"></label><button type="button" class="btn btn-ghost btn-sm" data-action="card-album-search" ${state.busy?"disabled":""}>搜尋</button>
 ${state.targets?`<div class="card-album-targets">${state.targets.map(x=>`<button type="button" class="btn btn-ghost btn-sm" data-action="card-album-target" data-uid="${esc(x.uid)}">${esc(x.name||x.playerId||"玩家")}</button>`).join("")||"沒有找到允許搜尋的玩家"}</div>`:""}
 ${target?`<p>交換對象：${esc(target.name||target.playerId||"玩家")}</p>`:""}
 ${target&&duplicates.length?`<label>我提供 <select id="card-album-give">${duplicates.map(c=>`<option value="${c.id}">${esc(c.name)} ×${Number(counts[c.id])}</option>`).join("")}</select></label><label>想交換 <select id="card-album-want">${CARD_ALBUM_CARDS.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><button type="button" class="btn btn-primary btn-sm" data-action="card-album-offer" ${state.busy?"disabled":""}>發出交換邀請</button>`:""}
 <h4>收到的邀請</h4>${incoming.length?incoming.map(x=>`<div class="card-album-trade-row"><div><strong>來自：${esc(x.peer?.name||"玩家")}</strong>${x.peer?.playerId?` <span class="hint">（${esc(x.peer.playerId)}）</span>`:""}</div><div class="hint">對方提供：${esc(CARD_ALBUM_CARDS.find(c=>c.id===x.give)?.name||"卡片")}｜希望取得：${esc(CARD_ALBUM_CARDS.find(c=>c.id===x.want)?.name||"卡片")}</div><div class="btn-row" style="margin-top:6px"><button type="button" class="btn btn-primary btn-sm" data-action="card-album-accept" data-trade="${esc(x.id)}">確認交換</button><button type="button" class="btn btn-ghost btn-sm" data-action="card-album-reject" data-trade="${esc(x.id)}">拒絕</button></div></div>`).join(""):'<p class="hint">沒有待確認的邀請</p>'}
 <h4>已發出的邀請</h4>${outgoing.length?outgoing.map(x=>`<div class="card-album-trade-row"><div>給 ${esc(x.peer?.name||"玩家")}${x.peer?.playerId?` <span class="hint">（${esc(x.peer.playerId)}）</span>`:""}</div><div class="hint">提供 ${esc(CARD_ALBUM_CARDS.find(c=>c.id===x.give)?.name||"卡片")}｜換取 ${esc(CARD_ALBUM_CARDS.find(c=>c.id===x.want)?.name||"卡片")}</div><button type="button" class="btn btn-ghost btn-sm" data-action="card-album-cancel" data-trade="${esc(x.id)}">取消</button></div>`).join(""):'<p class="hint">沒有待確認的邀請</p>'}
 </section>`;
}
document.addEventListener("change",event=>{
 if(event.target?.id!=="card-album-set-filter")return;
 const value=event.target.value;
 cardAlbumSetFilter=value==="all"||CARD_ALBUM_SETS.some(set=>set.id===value)?value:"all";
 cardAlbumPreview=null;renderPreservingScroll();
});
document.addEventListener("click",async event=>{
 const target=event.target.closest?.('[data-action^="card-album-"]');if(!target||playerActiveTab!=="cards")return;
 const action=target.dataset.action,state=cardAlbumContext();
 if(action==="card-album-close"&&event.target!==target&&target.classList.contains("card-album-preview-overlay"))return;
 if(action==="card-album-preview"){
  const set=target.dataset.set,card=target.dataset.card;
  if(Number(state.data?.sets?.[set]?.[card])>0){cardAlbumPreview={set,card};renderPreservingScroll();}
  return;
 }
 if(action==="card-album-close"){cardAlbumPreview=null;renderPreservingScroll();return;}
 if(action==="card-album-refresh"){await loadCardAlbum(true);return;}
 if(state.busy)return;
 if(action==="card-album-target"){state.targetUid=target.dataset.uid;renderPreservingScroll();return;}
 if(action==="card-album-search"){
  const query=document.getElementById("card-album-query")?.value.trim()||"";
  state.query=query;if(query.length<2){showToast("請輸入至少兩個字",true);return;}
  state.busy=true;renderPreservingScroll();
  try{const result=await window.engagementService.playerCard({action:"search",query});state.targets=result.players||[];state.targetUid="";}
  catch(e){showToast(String(e.message||e),true);}
  finally{state.busy=false;renderPreservingScroll();}
  return;
 }
 const tradeId=target.dataset.trade;
 let payload=null;
 if(action==="card-album-offer")payload={action:"offer",targetUid:state.targetUid,give:document.getElementById("card-album-give")?.value,want:document.getElementById("card-album-want")?.value};
 if(action==="card-album-accept")payload={action:"accept",tradeId};
 if(action==="card-album-reject")payload={action:"reject",tradeId};
 if(action==="card-album-cancel")payload={action:"cancel",tradeId};
 if(!payload)return;
 state.busy=true;
 try{
  await window.engagementService.cardAlbum(payload);
  showToast(action==="card-album-offer"?"交換邀請已送出":action==="card-album-accept"?"交換完成":action==="card-album-reject"?"已拒絕交換邀請":"已取消交換邀請");
  await loadCardAlbum(true);
 }
 catch(e){
  const message=String(e?.message||e||"");
  if(message.includes("insufficient-duplicate")){
    openModal({type:"generic",title:"交換失敗",message:"您的卡片數量不足。\n\n卡牌交換需至少持有 2 張，交換後系統會保留 1 張於卡冊中。",confirmLabel:"我知道了",onConfirm:()=>{}});
  }else showToast(message,true);
 }
 finally{state.busy=false;renderPreservingScroll();}
});

Object.assign(window.BXHCardAlbumFeature||(window.BXHCardAlbumFeature={}),{cardAlbumContext,loadCardAlbum,cardAlbumImage,renderCardAlbumPage,renderCardAlbumTrade});
