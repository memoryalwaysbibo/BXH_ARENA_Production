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
})();