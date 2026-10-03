(function(){
'use strict';
const OCT_CARD_REWARD_TYPE='card_reward';
function escHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function rewardOf(message){return message&&message.type===OCT_CARD_REWARD_TYPE?message.reward:null;}
function isClaimed(reward){return reward?.claimedAt!=null||reward?.status==='claimed';}
function isGodsPack(reward){return reward?.kind==='gods_card_pack';}
const CARD_NAMES=Object.freeze({double_extreme:'雙重極限',double_knockout:'雙重擊飛',double_burst:'雙重爆裂',double_spin:'雙重轉停',boost_extreme:'強化極限',boost_knockout:'強化擊飛',boost_burst:'強化爆裂',weaken_extreme:'極限弱化',weaken_knockout:'擊飛弱化',weaken_burst:'爆裂弱化',weaken_spin:'轉停弱化',seal:'附魔封印'});
function cardName(id){return CARD_NAMES[String(id||'')]||'諸神戰場卡牌';}
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
  isVirtualAttachment(message,item){
    const r=rewardOf(message);
    return !!(isGodsPack(r)&&item?.kind==='gods_card_pack'&&item?.mime==='application/x-bxh-card-pack');
  },
  card(message,busy){
    const r=rewardOf(message);if(!r||!['card','gods_card_pack'].includes(r.kind))return '';
    const claimed=isClaimed(r),pack=isGodsPack(r),art=cardArt(r),name=cardName(r.cardId);
    const bonus=claimed&&Array.isArray(r.bonus)&&r.bonus.length?'<span>第 12 場補齊缺卡：'+r.bonus.map(cardName).map(escHtml).join('、')+'</span>':'';
    return '<section class="card-reward-mail-card" data-card-reward-message="'+escHtml(message.id||'')+'">'
      +'<div class="card-reward-mail-kicker">🎴 賽事卡牌獎勵</div>'
      +'<div class="card-reward-mail-art"><img src="'+escHtml(art)+'" alt="'+escHtml(claimed?name:'未揭曉卡牌')+'"></div>'
      +'<div class="card-reward-mail-meta"><strong>'+(claimed?escHtml(name):(pack?'諸神戰場卡包 ×1':'完成賽事獎勵'))+'</strong>'
      +'<span>'+(claimed?'已領取並收入我的卡冊':'🎴 點擊領取後揭曉卡牌')+'</span>'+bonus+'</div>'
      +'<button class="btn btn-primary" data-action="mailbox-card-reward" data-message-id="'+escHtml(message.id||'')+'" '+(busy||claimed?'disabled':'')+'>'
      +(claimed?'已領取 ✓':'領取卡牌')+'</button></section>';
  },
  async claim(messageId,message){
    if(!messageId)throw Error('card-reward-message-required');
    const svc=window.engagementService,r=rewardOf(message);
    if(isGodsPack(r)){
      if(!svc||typeof svc.cardAlbum!=='function')throw Error('card-reward-service-unavailable');
      const result=await svc.cardAlbum({action:'claimPack',messageId});
      if(!result?.ok||!result.cardId)throw Error('card-pack-claim-failed');
      return {ok:true,card:{id:result.cardId,setId:'gods',name:cardName(result.cardId)},bonus:Array.isArray(result.bonus)?result.bonus:[]};
    }
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
  const originalMailboxHandler=mailboxFeature.handleMailbox;
  handleMailbox=async function(action,target){
    if(action!=='mailbox-card-reward')return originalMailboxHandler(action,target);
    const context=mailboxFeature.mailboxContext();
    if(!firebaseUser?.uid||context.busy)return;
    const messageId=target.getAttribute('data-message-id')||'';
    const message=(context.messages||[]).find(item=>item.id===messageId)||null;
    context.busy=true;context.error='';render();
    try{
      await window.BXHCardRewardUI.claim(messageId,message);
      if(context!==mailboxFeature.mailboxContext())return;
      // Includes already-claimed replays. The server alone supplies quantities.
      // Do not keep the claim handler pending on the background album read.
      void loadCardAlbum(true);
      context.messages=null;context.busy=false;await mailboxFeature.loadMailbox(true);
      if(context!==mailboxFeature.mailboxContext())return;
      showToast('卡牌已領取並收入我的卡冊');
    }catch(error){if(context===mailboxFeature.mailboxContext())context.error=mailboxFeature.mailboxError(error);}
    finally{if(context===mailboxFeature.mailboxContext()){context.busy=false;render();}}
  };
  albumFeature.cardAlbumContext=cardAlbumContext;
  albumFeature.loadCardAlbum=loadCardAlbum;
  mailboxFeature.handleMailbox=handleMailbox;
}
})();
