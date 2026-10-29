/* v9.1.1 presentation integration. Current grade is supplied by the existing caller.
 * No rank calculation, profile mutation, serial allocation or service calls. */
(function(root){
 'use strict';
 const grades=Object.freeze(['ungraded','e','d','c','b','a','s','national']);
 const labels=Object.freeze({ungraded:'未分級',e:'E 級獵人',d:'D 級獵人',c:'C 級獵人',b:'B 級獵人',a:'A 級獵人',s:'S 級獵人',national:'國家級獵人'});
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function avatarUrl(value){
  const raw=String(value??'');
  if(/^data:image\/(?:jpeg|png|webp|gif);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)&&raw.split(',')[1])return raw;
  try{const url=new URL(raw);return ['https:','http:'].includes(url.protocol)?url.href:'';}catch{return '';}
 }
 // numberIdentity must come from an authenticated server ledger reader, never users profile fields.
 function identityText(record,uid){
  if(!uid||record?.uid!==uid||record?.status!=='assigned'||record?.source!=='player-number-ledger')return {number:'待配號',joined:'待核對'};
  const number=record.number,raw=record.authCreatedAtMilliseconds;
  if(typeof number!=='string'||!/^[1-9][0-9]*$/.test(number)||typeof raw!=='string'||!/^[0-9]{1,16}$/.test(raw))return {number:'待配號',joined:'待核對'};
  const ms=Number(raw),date=new Date(ms);
  if(!Number.isSafeInteger(ms)||ms<=0||!Number.isFinite(date.getTime()))return {number:'待配號',joined:'待核對'};
  return {number:number.padStart(5,'0'),joined:date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})};
 }
 function render({profile={},name='玩家',currentGrade,numberIdentity=null,accountUid=''}={}){
  const identity=identityText(numberIdentity,accountUid);
  const tier=grades.includes(currentGrade?.tier)?currentGrade.tier:'pending';
  const label=tier==='pending'?(currentGrade?.label||'資料待核對'):labels[tier];
  const photo=avatarUrl(profile?.avatarUrl);
  const size=tier==='b'?[2135,736]:tier==='national'?[1983,793]:[2172,724];
  return '<section class="hl3" data-tier="'+tier+'" aria-label="獵人執照">'+
   '<header class="hl3-heading"><span>BXH ARENA</span><p lang="en">HUNTER LICENSE</p><h3>獵人執照</h3></header>'+
   '<div class="hl3-body"><div class="hl3-portrait">'+
   (photo?'<img data-hl3-image src="'+esc(photo)+'" alt="'+esc(name)+'的頭像" referrerpolicy="no-referrer" decoding="async">':'')+
   '<span role="img" aria-label="尚未設定頭像"'+(photo?' hidden':'')+'>'+esc(Array.from(name)[0]||'獵')+'</span></div>'+
   '<div class="hl3-identity"><h4>'+esc(name)+'</h4><dl><div><dt>執照編號</dt><dd>'+esc(identity.number)+'</dd></div><div><dt>加入日期</dt><dd class="hl3-date">'+esc(identity.joined)+'</dd></div></dl></div>'+
   '<div class="hl3-rank" data-tier="'+tier+'"><p>目前階級</p>'+
   (tier==='pending'?'<div class="hl3-pending">◇</div><strong>'+esc(label)+'</strong>':
    '<img data-hl3-image src="assets/hunter-ranks/license-v911/'+tier+'.png" alt="'+esc(label)+'" width="'+size[0]+'" height="'+size[1]+'" decoding="async">'+
    '<strong class="hl3-image-fallback" hidden>'+esc(label)+'</strong>')+'</div></div>'+
   '<footer class="hl3-foot">依現有可信對戰判定 · 非生涯最高／裝備稱號</footer></section>';
 }
 const doc=root.document;
 if(doc){
  const mobile=root.matchMedia('(max-width:560px)');
  function arrange(card){
   const body=card.querySelector('.hl3-body'),identity=body?.querySelector('.hl3-identity'),rank=body?.querySelector('.hl3-rank');
   if(!identity||!rank)return;
   if(mobile.matches){if(rank.parentElement!==identity)identity.insertBefore(rank,identity.querySelector('dl'));}
   else if(rank.parentElement!==body)body.appendChild(rank);
  }
  const arrangeAll=()=>doc.querySelectorAll('.hl3').forEach(arrange);
  // Re-renders replace cards. Observe only added card roots/containers; moving the
  // existing rank does not match this scan, so it cannot start a mutation loop.
  new root.MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){
   if(node.nodeType!==1)continue;
   if(node.matches('.hl3'))arrange(node);else node.querySelectorAll('.hl3').forEach(arrange);
  }}).observe(doc,{childList:true,subtree:true});
  if(mobile.addEventListener)mobile.addEventListener('change',arrangeAll);else mobile.addListener(arrangeAll);
  doc.addEventListener('error',event=>{const img=event.target;
   if(!img?.matches?.('img[data-hl3-image]'))return;
   img.hidden=true;
   const fallback=img.parentElement.querySelector('.hl3-image-fallback,span[role="img"]');
   if(fallback)fallback.hidden=false;
  },true);
  arrangeAll();
 }
 root.BXHHunterLicenseVisual=Object.freeze({render,grades});
})(window);
