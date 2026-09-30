(function(){
'use strict';
function titleArt(reward){return String(reward?.artwork||({'s2_champion':'assets/title-limited-s2-champion.webp','s3_champion':'assets/title-limited-s3-champion.webp'})[reward?.titleId]||'');}
function labelTier(v){return ({eternal:'永恆',legendary:'傳說',epic:'史詩',rare:'稀有',common:'一般'})[v]||String(v||'稱號');}
function labelLimited(v){return ({unique:'唯一限定',event:'活動限定',season:'賽季限定',identity:'身分限定',launch:'開服限定',beta:'封測限定'})[v]||'';}
window.BXHTitleRewardUI={
 card(message,busy){
  const r=message?.reward;if(message?.type!=='title_reward'||r?.kind!=='title')return '';
  const opened=r.openedAt!=null||r.status==='opened',art=titleArt(r);
  return '<section class="title-reward-mail-card"><div class="title-reward-mail-kicker">TITLE REWARD ATTACHMENT</div>'+(art?'<img src="'+esc(art)+'" alt="'+esc(r.titleName||'稱號')+'">':'')+'<div class="title-reward-mail-meta"><strong>'+esc(r.titleName||'榮譽稱號')+'</strong><span>'+esc(labelTier(r.rarityTier))+(labelLimited(r.limitedType)?'・'+esc(labelLimited(r.limitedType)):'')+'</span></div><button class="btn btn-primary" data-action="mailbox-title-reward" data-message-id="'+esc(message.id)+'" data-replay="'+(opened?'1':'0')+'" '+(busy?'disabled':'')+'>'+(opened?'再次觀看授勳':'接受稱號')+'</button></section>';
 },
 async open(messageId,replay){
  const result=await window.engagementService.claimTitleReward({messageId,action:replay?'replay':'open'});
  if(!result?.ok||!result.title)throw Error('title-reward-open-failed');
  const t=result.title;
  const url=t.id==='s2_champion'?'title-ceremony-s2-demo.html':t.id==='s3_champion'?'title-ceremony-s3-demo.html':'';
  if(url){const w=window.open(url+'?ceremony=1','_blank','noopener');if(!w)location.href=url+'?ceremony=1';}
  else showToast('稱號已接受；此稱號的專屬授勳動畫準備中');
  return result;
 }
};
})();