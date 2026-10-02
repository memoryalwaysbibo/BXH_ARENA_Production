(function(){
'use strict';
const OCT_CARD_REWARD_TYPE='card_reward';
function escHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function rewardOf(message){return message&&message.type===OCT_CARD_REWARD_TYPE?message.reward:null;}
function isClaimed(reward){return reward?.claimedAt!=null||reward?.status==='claimed';}
function cardArt(reward){
  const direct=String(reward?.artwork||reward?.imageUrl||'').trim();
  if(direct)return direct;
  const id=String(reward?.cardId||'').trim();
  const set=String(reward?.setId||reward?.set||'').trim();
  if(!id)return 'assets/enchantment-gods/back.webp';
  if(set==='basic')return 'assets/enchantment-basic/'+encodeURIComponent(id)+'.svg';
  return 'assets/enchantment-gods/'+encodeURIComponent(id)+'.webp';
}
window.BXHCardRewardUI={
  card(message,busy){
    const r=rewardOf(message);if(!r||r.kind!=='card')return '';
    const claimed=isClaimed(r),art=cardArt(r);
    return '<section class="card-reward-mail-card" data-card-reward-message="'+escHtml(message.id||'')+'">'
      +'<div class="card-reward-mail-kicker">📎 獎勵附件（1）</div>'
      +'<div class="card-reward-mail-art"><img src="'+escHtml(art)+'" alt="'+escHtml(claimed?(r.cardName||'活動卡牌'):'未揭曉卡牌')+'"></div>'
      +'<div class="card-reward-mail-meta"><strong>'+(claimed?escHtml(r.cardName||'活動卡牌'):'完成賽事獎勵')+'</strong>'
      +'<span>'+(claimed?'已領取並收入我的卡冊':'🎴 活動卡牌 × 1')+'</span></div>'
      +'<button class="btn btn-primary" data-action="mailbox-card-reward" data-message-id="'+escHtml(message.id||'')+'" '+(busy||claimed?'disabled':'')+'>'
      +(claimed?'已領取 ✓':'領取附件')+'</button></section>';
  },
  async claim(messageId){
    if(!messageId)throw Error('card-reward-message-required');
    const svc=window.engagementService;
    if(!svc||typeof svc.claimCardReward!=='function')throw Error('card-reward-service-unavailable');
    const result=await svc.claimCardReward({messageId,action:'claim'});
    if(!result?.ok||!result.card)throw Error('card-reward-claim-failed');
    return result;
  }
};
// This classic script is loaded after the main inline application. Keep the
// reward/album integration here so the existing mailbox and card-tab dispatchers
// use these session-safe handlers without a second UI or optimistic inventory.
const albumFeature=window.BXHCardAlbumFeature;
const mailboxFeature=window.BXHMailbox;
if(albumFeature&&typeof albumFeature.cardAlbumContext==='function'&&typeof albumFeature.loadCardAlbum==='function'&&mailboxFeature&&typeof mailboxFeature.handleMailbox==='function'){
  let cardAlbumContext=albumFeature.cardAlbumContext;
  let loadCardAlbum=albumFeature.loadCardAlbum;
  let handleMailbox=mailboxFeature.handleMailbox;
  cardAlbumState=null;
  cardAlbumContext=function(){
    const uid=firebaseUser?.uid||'',key=uid+':'+engagementSessionEpoch;
    if(!cardAlbumState||cardAlbumState.key!==key){
      cardAlbumState={key,uid,revision:0,data:null,loading:false,error:'',trades:null,targets:null,query:'',targetUid:'',busy:false};
      cardAlbumPreview=null;
    }
    return cardAlbumState;
  };
  loadCardAlbum=async function(refresh=false){
    const state=cardAlbumContext();
    if(!state.uid||(!refresh&&(state.loading||state.data)))return;
    // Forced reads supersede even an in-flight pre-claim request.
    const revision=++state.revision;
    const isCurrent=()=>state===cardAlbumContext()&&state.revision===revision;
    if(refresh){state.data=null;state.trades=null;}
    state.loading=true;state.error='';renderPreservingScroll();
    try{
      if(!window.engagementService?.cardAlbum)throw Error('卡冊服務尚未連線');
      const [data,trades]=await Promise.all([window.engagementService.cardAlbum({action:'get'}),window.engagementService.cardAlbum({action:'list'})]);
      if(!isCurrent())return;
      if(!data?.ok||!data.sets||!trades?.ok)throw Error('卡冊暫時無法讀取');
      state.data=data;state.trades=trades;state.error='';
    }catch(error){if(isCurrent())state.error=String(error?.message||'卡冊暫時無法讀取').slice(0,130);}
    finally{if(isCurrent()){state.loading=false;renderPreservingScroll();}}
  };
  const originalMailboxHandler=handleMailbox;
  handleMailbox=async function(action,target){
    if(action!=='mailbox-card-reward')return originalMailboxHandler(action,target);
    const context=mailboxContext();
    if(!firebaseUser?.uid||context.busy)return;
    const messageId=target.getAttribute('data-message-id')||'';
    context.busy=true;context.error='';render();
    try{
      await window.BXHCardRewardUI.claim(messageId);
      if(context!==mailboxContext())return;
      // Includes already-claimed replays. The server alone supplies quantities.
      // Do not keep the claim handler pending on the background album read.
      void loadCardAlbum(true);
      context.messages=null;context.busy=false;await loadMailbox(true);
      if(context!==mailboxContext())return;
      showToast('卡牌已領取並收入我的卡冊');
    }catch(error){if(context===mailboxContext())context.error=mailboxError(error);}
    finally{if(context===mailboxContext()){context.busy=false;render();}}
  };
}
})();
