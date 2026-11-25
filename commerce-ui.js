/* Manual-bank commerce. Server owns price, eligibility, receipts and delivery. */
(function(){
'use strict';
let state=null;
const paymentLabels={pending:'待付款',reported:'待對帳',paid:'已確認收款',cancelled:'已取消',refund_pending:'退款處理中',refunded:'已退款'};
const deliveryLabels={not_started:'尚未交付',pending:'交付處理中',failed:'交付待處理',delivered:'已交付',revoked:'已收回',cancelled:'已取消交付'};
const kinds={room_quota:'開房次數',vip:'VIP 功能',skin:'Skin 外觀',item:'道具',ticket:'賽事啟動券'};
const storefrontKinds=new Set(['skin','item','ticket']);
const canSeeTickets=()=>isPartnerOrganizerMode();
const canManagePtn=()=>canSeeTickets()||isSuperAdmin();
const storefrontKindVisible=kind=>storefrontKinds.has(kind)&&(kind!=='ticket'||canSeeTickets());
const ticketPrices=[300,600,1000,1500,2000];
const ticketPreviews=[32,64,96,128,160].map((capacity,index)=>({
 id:`tournament_activation_${capacity}`,name:`賽事啟動券｜${capacity} 人`,capacity,
 priceTwd:ticketPrices[index],
 imageUrl:`assets/commerce/tickets/tournament-activation-${capacity}-${['green','blue','purple','orange','red'][index]}.png`,
 previewOnly:true,delivery:{kind:'ticket'}
}));
const ticketPreviewIds=new Set(ticketPreviews.map(p=>p.id));
function visibleProducts(c){
 const catalog=c.products||[];
 const otherProducts=catalog.filter(p=>p?.delivery?.kind!=='ticket'&&storefrontKindVisible(p?.delivery?.kind)&&!ticketPreviewIds.has(p.id));
 if(!canSeeTickets())return otherProducts;
 const ticketCards=ticketPreviews.map(preview=>{
  const offer=c.storeOpen===true&&catalog.find(p=>p?.delivery?.kind==='ticket'
   &&typeof p.id==='string'&&p.id&&p.status==='published'&&p.audience==='partner_organizer'
   &&p.delivery.assetId===String(preview.capacity)&&p.delivery.quantity===1&&p.delivery.durationDays===0
   &&p.priceTwd===preview.priceTwd
   &&Number.isSafeInteger(p.priceTwd)&&p.priceTwd>0&&Number.isSafeInteger(p.version)&&p.version>0);
  return offer?{...offer,id:preview.id,orderProductId:offer.id,imageUrl:preview.imageUrl,previewOnly:false}:preview;
 });
 return [...ticketCards,...otherProducts];
}
function purchasable(p){return p?.purchasable===true&&!p.previewOnly;}
function audienceLabel(audience){
 return ({signed_organizer:'有效簽約活動主辦',partner_organizer:'有效合作主辦'})[audience]||'符合資格的會員';
}
const storageKey=()=> 'bxh.commerce.pending.v1:'+currentAuthUid();
function context(){
 const session=currentAuthUid()+':'+engagementSessionEpoch;
 if(!state||state.session!==session){
  let pending=null;try{pending=JSON.parse(sessionStorage.getItem(storageKey())||'null');if(pending?.uid!==currentAuthUid())pending=null;}catch{}
  state={session,products:null,productsCursor:null,tickets:null,ticketsOpen:false,ticketRoomOpen:false,ticketRoom:null,ticketDraft:null,peopleSection:'confirmed',ptnRoomCards:{},ptnRoomCardScheduled:false,ptnRoomCardLoading:false,ptnRoomLimit:5,orders:null,ordersCursor:null,config:null,capabilities:{},loading:false,busy:false,error:'',success:'',category:'',productId:'',order:null,adminZone:'orders',status:'reported',draft:null,configDraft:null,pending,formDrafts:{},generation:0,storeOpen:null};
 }
 return state;
}
function errorMessage(e){
 const m=String(e?.message||e||'');
 const labels={'service-unavailable':'商城服務準備中，請稍後再試。','store-closed':'商城尚未開放購買。','delivery-not-ready':'此類商品的交付功能尚未完成驗證，暫時不能上架或購買。','product-unavailable':'商品目前無法購買，請重新整理商城。','product-changed':'商品內容已更新，請重新整理後確認。','version-conflict':'資料已被更新，請重新整理後再編輯。','contract-required':'此商品限已簽約且授權有效的活動主辦購買。','contract-expired':'主辦合約尚未生效或已到期。','partner-organizer-required':'此商品限授權有效的合作主辦購買。','ticket-holding-limit':'已達同時持有 2 張的上限，待付款訂單也計入預留名額。','ticket-monthly-limit':'本月已達五款合計 4 張的限購上限。','ticket-quota-needs-review':'票券資料需要核對，請聯絡 BXH。','ticket-lifecycle-disabled':'目前沒有開放這間票券房的試點操作。','ticket-unavailable':'這張券目前無法用來建房，請重新整理票券。','ticket-expired':'啟動券已到期，或會在預定開賽前到期。','ticket-binding-invalid':'票券與房間資料不一致，請重新整理。','forfeit-room-not-live':'只有進行中的賽事可以登記棄權。','forfeit-match-stale':'對戰資料已更新，請重新整理後再操作。','forfeit-round-waiting':'這場對戰目前尚未開放。','ticket-ptn-slot-occupied':'PTN 試點房間數已達上限，請聯絡 BXH。','room-code-conflict':'試點房號已使用，請重新整理。','bracket-version-conflict':'抽籤資料已變更，請重新整理後再操作。','bracket-roster-changed':'可出賽名單已變更，請重新整理後再操作。','registration-roster-stale':'報名名單已更新，請重新整理後再操作。','registration-queue-pending':'報名資料正在更新，請稍後再試。','registration-queue-disabled':'這間賽事尚未開放 V2 操作。','early-start-confirmation-required':'尚未到預定開賽時間。','not-found':'目前找不到這間票券房。','unpaid-order-exists':'此商品已有未完成訂單，請到我的訂單查看。','already-owned':'你已持有此 Skin，無須重複購買。','bank-receipt-used':'這筆銀行交易已核銷，請確認是否重複使用。','amount-mismatch':'金額不符，請先釐清差額再確認。','payment-window-closed':'已超過付款期限或訂單狀態已變更，請聯絡 BXH。','invalid-remittance':'請填寫匯款末五碼與正確的轉帳時間。','refund-needs-review':'商品已有使用或後續異動，需要人工評估，暫不能自動收回。','transition-forbidden':'訂單狀態已變更，請重新讀取確認。','operation-conflict':'操作識別碼與原請求不一致，請保留訂單編號聯絡 BXH。','storage-unavailable':'瀏覽器無法保存待確認操作，請允許工作階段儲存後再試。','super-admin-required':'只有最高管理員可以執行此操作。','account-inactive':'帳號目前不可購買。','invalid-bank':'請確認三碼銀行代碼及收款帳號。','invalid-number':'請檢查金額、數量或期限。','invalid-text':'請完整填寫欄位。','invalid-image':'商品圖片請使用 HTTPS 網址。','invalid-vip-duration':'VIP 須設定有效天數，數量為 1。','invalid-quota-duration':'場次額度的期限沿用合約，商品天數請填 0。','cancel-unavailable':'這筆訂單已無法自行取消。','order-unavailable':'找不到可查看的訂單。','invalid-action':'無法執行這項操作。'};
 for(const [k,v]of Object.entries(labels))if(m.includes(k))return v;
 return '連線尚未確認，請重試；系統會沿用原操作避免重複下單。';
}
function ticketRoomReadError(e){
 const message=String(e?.message||e||'');
 if(message.includes('app-check-unavailable')||message.includes('網站驗證未完成'))return '網站驗證未完成，請重新載入頁面後重試。';
 if(message.includes('permission-denied')||message.includes('unauthenticated')||message.includes('auth-required'))return '管理權限驗證失敗，請確認目前登入的帳號與此房主辦或代理人相同。';
 if(message.includes('deadline-exceeded')||message.includes('initialization-timeout'))return '賽事資料讀取逾時，請重新整理賽事。';
 if(message.includes('unavailable')||message.includes('network-request-failed'))return '目前無法連接賽事服務，請確認網路後重新整理賽事。';
 if(e?.code==='functions/internal'||message.includes('functions/internal'))return '賽事服務處理失敗（internal），請聯絡 BXH 查詢服務紀錄。';
 const known=errorMessage(e);
 return known.includes('重複下單')?'賽事資料讀取失敗，請聯絡 BXH 查詢服務紀錄。':known;
}
function ticketRoomMutationError(e){
 const message=String(e?.message||e||'');
 if(message.includes('app-check-unavailable')||message.includes('網站驗證未完成'))return '網站驗證未完成，請重新載入頁面後再操作。';
 if(message.includes('permission-denied')||message.includes('unauthenticated')||message.includes('auth-required'))return '賽事管理權限驗證失敗。請重新整理房間，並確認目前登入的是這間房的主辦、代理人或最高管理員。';
 const known=errorMessage(e);
 if(!known.includes('重複下單'))return known;
 if(message.includes('unavailable')||message.includes('deadline-exceeded')||message.includes('network-request-failed'))return '賽事操作尚未確認，請先重新整理房間，再確認原操作結果。';
 return known;
}
const permanentErrors=/forfeit-(room-not-live|match-stale|round-waiting)|registration-(queue-pending|queue-disabled|roster-stale)|early-start-confirmation-required|bracket-started|ticket-lifecycle-disabled|ticket-unavailable|ticket-expired|ticket-binding-invalid|room-code-conflict|ticket-ptn-slot-occupied|bracket-version-conflict|bracket-roster-changed|permission-denied|not-found|partner-organizer-required|ticket-holding-limit|ticket-monthly-limit|product-unavailable|store-closed|delivery-not-ready|product-changed|version-conflict|contract-required|contract-expired|unpaid-order-exists|already-owned|bank-receipt-used|amount-mismatch|payment-window-closed|invalid-|refund-needs-review|transition-forbidden|cancel-unavailable|account-inactive|super-admin-required|order-unavailable/;
const money=n=>'NT$ '+Number(n||0).toLocaleString('zh-TW');
const date=n=>n?new Date(n).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
function image(url){if(/^assets\/commerce\/tickets\/tournament-activation-(32-green|64-blue|96-purple|128-orange|160-red)\.png$/.test(url))return url;try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function notices(c){return `${c.error?`<p class="commerce-error" role="alert">${esc(c.error)}</p>`:''}${c.success?`<p class="commerce-success" role="status">${esc(c.success)}</p>`:''}${c.pending?`<div class="banner"><span>有一筆操作尚待確認。</span><button class="btn btn-primary" data-action="commerce-retry" ${c.busy?'disabled':''}>確認原操作結果</button></div>`:''}`;}
const pilotCode=()=>window.BXH_TICKET_ROOM_PILOT_CODE;
const ticketActions=new Set(['create-ticket-room','ticket-ptn-status','ticket-room-state','ticket-room-schedule','ticket-room-delegate','ticket-room-delegate-search','ticket-room-draw','ticket-room-start','ticket-room-remove','ticket-room-forfeit','ticket-room-score']);
const ticketSaleMode=()=>canSeeTickets()&&window.BXH_PTN_TICKET_SALE===true;
const ticketPilot=()=>canSeeTickets()&&(ticketSaleMode()||typeof pilotCode()==='string'&&/^BXH-[A-Z0-9]{4,16}$/.test(pilotCode()));
const ticketCreationView=c=>c.view==='ticket-create'&&typeof activeTab!=='undefined'&&activeTab==='management';
const ptnCreation=c=>ticketCreationView(c)&&
 (ticketSaleMode()||window.BXH_TICKET_ROOM_PTN_PILOT===true);
const inManagement=()=>typeof activeTab!=='undefined'&&activeTab==='management';
const ticketManagementView=c=>canManagePtn()&&c.view==='ticket-manage'&&isPtnCode(c.ownedPtn?.code)
 &&(inManagement()||c.roomManageOpen&&['registrations','settings','people','live','bracket','referee','operations'].includes(activeTab));
const ticketRoomCode=c=>ticketManagementView(c)?c.ownedPtn.code:ptnCreation(c)?c.ptnStatus?.code:pilotCode();
const isPtnCode=code=>typeof code==='string'&&/^PTN-[A-Z0-9]{6}$/.test(code);
const ticketViewOpen=c=>ticketCreationView(c)||c.view==='shop'&&c.ticketsOpen;
const canOperateTicketRoom=c=>ticketManagementView(c)||(ticketPilot()&&ticketViewOpen(c));
const ticketAvailable=ticket=>ticket.status==='available'&&
 (ticket.expiresAt===null||ticket.expiresAt>Date.now());
async function call(payload){
 const service=window.engagementService;
 const handler=ticketActions.has(payload.action)?service?.ticketRoomOperation:service?.commerce;
 if(typeof handler!=='function')throw Error('service-unavailable');
 const r=await handler.call(service,payload);
 if(!r?.ok)throw Error(r?.error||'request-failed');
 return r;
}
async function load(kind,more=false,quiet=false){
 const c=context();if(c.loading||c.busy||!currentAuthUid())return;
 if(kind.startsWith('admin-')&&!isSuperAdmin())return;
 if(kind==='my-tickets'&&!canSeeTickets())return;
 if(kind==='ticket-room-state'&&(!canOperateTicketRoom(c)||!ticketRoomCode(c)))return;
 if(kind==='ticket-ptn-status'&&(!ticketPilot()||!ptnCreation(c)))return;
 const generation=++c.generation;c.loading=true;c.error='';if(!quiet)render();
 try{
  const cursor=more?(kind.includes('products')||kind==='catalog'?c.productsCursor:c.ordersCursor):null;
  const r=await call(kind==='ticket-room-state'?{action:kind,code:ticketRoomCode(c)}:kind==='ticket-ptn-status'?{action:kind}:{action:kind,cursor,...(kind==='admin-orders'?{status:c.status}:{})});if(c!==context()||generation!==c.generation)return;
  if(kind==='ticket-room-state'){c.ticketRoom=r;c.scheduleDraft=null;c.delegateSearch=null;}
  if(kind==='ticket-ptn-status')c.ptnStatus=r;
  if(typeof r.storeOpen==='boolean')c.storeOpen=r.storeOpen;
  if(r.products){c.products=more?[...(c.products||[]),...r.products]:r.products;c.productsCursor=r.nextCursor;}
  if(kind==='my-tickets'&&Array.isArray(r.tickets))c.tickets=r.tickets;
  if(r.orders){c.orders=more?[...(c.orders||[]),...r.orders]:r.orders;c.ordersCursor=r.nextCursor;}
  if(kind==='admin-config'){c.config=r.config;c.capabilities=r.capabilities;c.configDraft={enabled:r.config?.enabled===true,paymentHours:r.config?.paymentHours||48,bankCode:r.config?.bank?.bankCode||'',bankName:r.config?.bank?.bankName||'',branch:r.config?.bank?.branch||'',accountName:r.config?.bank?.accountName||'',accountNumber:r.config?.bank?.accountNumber||''};}
 }catch(e){if(c===context()&&generation===c.generation)c.error=kind==='ticket-room-state'?ticketRoomReadError(e):errorMessage(e);}finally{if(c===context()&&generation===c.generation){c.loading=false;render();}}
}
async function mutate(payload){
 const c=context();if(c.busy||c.loading)return;
 const view=c.view,scoring=payload.action==='ticket-room-score';c.busy=true;c.error='';c.success='';render();
 try{
  if(!c.pending){
   const pending={uid:currentAuthUid(),payload:{...payload,operationId:crypto.randomUUID()}};
   try{sessionStorage.setItem(storageKey(),JSON.stringify(pending));}catch{throw Error('storage-unavailable');}c.pending=pending;
  }
  const action=c.pending.payload.action;
  const r=await call(c.pending.payload);if(c!==context())return;
  c.pending=null;try{sessionStorage.removeItem(storageKey());}catch{}
  if(r.order&&view===c.view){delete c.formDrafts[r.order.id];c.order=r.order;c.orders=null;c.productId='';c.category='';}
  if(r.product){c.draft={...r.product,delivery:{...r.product.delivery}};c.products=null;}
  if(r.config){c.config=r.config;c.configDraft=null;}
  if(ticketActions.has(action)){
   c.tickets=null;c.ticketDraft=null;if(!scoring)c.ticketRoom=null;c.scheduleDraft=null;c.delegateSearch=null;
   if(scoring&&c.ticketRoom?.code===payload.code){
    const match=c.ticketRoom.bracket?.find(item=>item.id===payload.matchId);
    if(match){match.scoreA=r.scoreA;match.scoreB=r.scoreB;match.completed=r.completed;match.canScore=!r.completed;}
   }
   if(action==='create-ticket-room'&&isPtnCode(r.code))c.ownedPtn={code:r.code};
   if(view===c.view&&canOperateTicketRoom(c)){
    if(action==='create-ticket-room'&&ptnCreation(c)&&isPtnCode(r.code))c.ptnStatus={ok:true,code:r.code};
    c.ticketRoomOpen=true;
   }
  }
  c.success=({ 'create-ticket-room':'已建房並綁定啟動券。','ticket-room-schedule':'報名與開賽時間已更新。','ticket-room-delegate':'代理權已更新。','ticket-room-draw':'抽籤完成。','ticket-room-start':'正式開賽，啟動券已扣用。','ticket-room-remove':'已移除選手。請重新抽籤。','ticket-room-forfeit':'已登記棄權，對手晉級。','ticket-room-score':r.completed?'賽果已確認，選手已晉級。':'分數已儲存。'})[action]||'操作已確認完成。';
 }catch(e){if(c===context()){
  const failedAction=c.pending?.payload?.action||payload.action;
  c.error=failedAction?.startsWith('ticket-room-')?ticketRoomMutationError(e):errorMessage(e);
  if(permanentErrors.test(String(e?.message||e))){c.pending=null;try{sessionStorage.removeItem(storageKey());}catch{}}
 }}finally{if(c===context()){
  c.busy=false;
  // Keep the current court mounted until the authoritative post-score read arrives.
  if(scoring&&!c.pending)void load('ticket-room-state',false,true);
  else render();
 }}
}
function schedule(kind,empty){const c=context();if(empty&&!c.loading&&!c.busy&&!c.error)setTimeout(()=>load(kind),0);}
function productDetails(p,c){
 if(p.previewOnly)return `<section class="panel commerce-detail"><button class="btn btn-ghost" data-action="commerce-back-products">返回商品清單</button><img class="commerce-hero" src="${esc(image(p.imageUrl))}" alt="${esc(p.name)}"><h2>${esc(p.name)}</h2><p class="commerce-ticket-status" role="status">尚未開放購買</p><p class="commerce-price">${money(p.priceTwd)}</p><p class="commerce-copy">單場積分賽適用，基本正取上限 ${p.capacity} 人。開房時選券並綁定房間，開賽後使用一張券。</p><dl class="commerce-facts"><dt>購買資格</dt><dd>授權有效的合作主辦</dd><dt>使用期限</dt><dd>無期限，開賽後扣用</dd></dl><button class="btn btn-primary" disabled aria-disabled="true">尚未開放購買</button></section>`;
 return `<section class="panel commerce-detail"><button class="btn btn-ghost" data-action="commerce-back-products">返回商品清單</button>${image(p.imageUrl)?`<img class="commerce-hero" src="${esc(image(p.imageUrl))}" alt="${esc(p.name)}">`:''}<h2>${esc(p.name)}</h2><p class="commerce-price">${money(p.priceTwd)}</p><p class="commerce-copy">${esc(p.description)}</p><dl class="commerce-facts"><dt>商品類型</dt><dd>${esc(kinds[p.delivery.kind])}</dd><dt>購買資格</dt><dd>${audienceLabel(p.audience)}</dd><dt>內容數量</dt><dd>${Number(p.delivery.quantity)}</dd><dt>持有／使用期限</dt><dd>${p.delivery.kind==='room_quota'?'依主辦合約與商品條款':p.delivery.durationDays?Number(p.delivery.durationDays)+' 天':'無使用期限'}</dd></dl><h3>購買說明</h3><p class="commerce-copy">${esc(p.terms)}</p><p class="hint">銀行轉帳後，請至我的訂單回報匯款資訊。BXH 確認收款後交付。</p>${!purchasable(p)?`<p role="status">${esc(errorMessage(p.unavailableReason))}</p>`:''}<label class="commerce-consent"><input type="checkbox" data-commerce-consent> 我已閱讀商品內容、資格、期限與購買說明</label><button class="btn btn-primary" data-action="commerce-buy" data-id="${esc(p.id)}" ${c.busy||c.loading||c.pending||!purchasable(p)?'disabled':''}>建立訂單｜${money(p.priceTwd)}</button></section>`;
}
function enter(view){const c=context();if(c.view!==view){c.view=view;c.generation++;c.loading=false;c.storeOpen=null;c.products=null;c.tickets=null;c.ticketsOpen=false;c.ticketRoomOpen=false;c.ticketRoom=null;c.delegateSearch=null;c.ticketDraft=null;c.roomManageOpen=false;c.roomManageTab='registrations';c.peopleSection='confirmed';c.ptnStatus=null;c.orders=null;c.order=null;c.error='';c.success='';}return c;}
function ticketWallet(c){
 const locked=c.loading||c.busy||!!c.pending;
 const managePilot=!ticketSaleMode()&&ticketPilot()&&c.tickets&&
  !c.tickets.some(ticket=>ticket.boundRoomCode===pilotCode());
 const controls=ticket=>!ticketPilot()?'':ticket.status==='available'
  ?`<button class="btn btn-primary" data-action="commerce-ticket-bind" data-id="${esc(ticket.id)}" ${locked?'disabled':''}>選這張券建房</button>`
  :isPtnCode(ticket.boundRoomCode)?`<button class="btn btn-ghost" data-action="commerce-open-ticket-room" data-id="${esc(ticket.boundRoomCode)}" ${locked?'disabled':''}>管理賽事</button>`:'';
 return `<section class="commerce"><div class="panel-title"><h2>我的啟動券</h2><button class="btn btn-ghost" data-action="commerce-close-tickets">返回商城</button></div>${notices(c)}${c.loading?'<p role="status">正在讀取啟動券……</p>':c.tickets===null?'':c.tickets.length?`<div class="commerce-orders">${c.tickets.map(ticket=>`<article class="panel commerce-order"><span><strong>賽事啟動券｜${Number(ticket.capacity)} 人</strong><small>${ticket.status==='reserved'?'已綁定房間 '+esc(ticket.boundRoomCode):'可使用'}</small>${controls(ticket)}</span><span><small>${ticket.expiresAt===null?'無使用期限':'到期時間（台灣時間）<br>'+date(ticket.expiresAt)}</small></span></article>`).join('')}</div>`:'<div class="empty-state">目前沒有有效的啟動券。</div>'}${managePilot?`<button class="btn btn-ghost" data-action="commerce-ticket-room" ${locked?'disabled':''}>管理試點賽事</button>`:''}<button class="btn btn-ghost" data-action="commerce-refresh-tickets" ${c.loading?'disabled':''}>重新整理</button></section>`;
}
function ticketForfeitPanel(room,pending){
 if(room.phase!=='live'||!room.matches?.length)return '';
 return `<details><summary>登記對戰棄權</summary><ul>${room.matches.map(match=>`
  <li>第 ${Number(match.seq)+1} 場
   <button type="button" class="btn btn-ghost" data-action="commerce-ticket-forfeit" data-id="${esc(match.id)}" data-side="a" ${pending?'disabled':''}>${esc(match.a.name)} 棄權</button>
   <button type="button" class="btn btn-ghost" data-action="commerce-ticket-forfeit" data-id="${esc(match.id)}" data-side="b" ${pending?'disabled':''}>${esc(match.b.name)} 棄權</button></li>`).join('')}</ul></details>`;
}
function ticketBracketPanel(room){
 if(room.phase==='waiting'&&!room.drawId)return '<div class="empty-state">尚未抽籤；抽籤完成後可在這裡預覽對戰表。</div>';
 const shared=window.BXHSharedTicketBracket?.render(room);
 return (room.drawReady===false?'<div class="banner warn">正取名單已變更，請重新抽籤。</div>':'')+
  (shared||'<div class="empty-state">對戰資料尚未取得，請重新整理房間。</div>');
}

function ticketLivePanel(room){
 if(room.phase==='waiting')return '<div class="empty-state">賽事尚未開賽；對戰組合可先至「對戰表」預覽，正式開賽後顯示即時戰況。</div>';
 const matches=(room.bracket||[]).filter(match=>!match.isBye),done=matches.filter(match=>match.completed).length;
 const percent=matches.length?Math.round(done/matches.length*100):0;
 const active=matches.filter(match=>!match.completed&&match.a&&match.b);
 const stations=[...new Set(active.map(match=>Number(match.station)||1))].sort((a,b)=>a-b);
 const courts=stations.map(station=>`<section class="panel live-court-card"><h3>${station} 號台</h3>${active.filter(match=>(Number(match.station)||1)===station).map(match=>`<div class="commerce-ptn-match-head"><span>第 ${Number(match.round)+1} 輪・第 ${Number(match.seq)+1} 場</span><span class="badge badge-metal">${match.scoreA||match.scoreB?'進行中':'待進行'}</span></div><div class="commerce-ptn-match-score"><span>${esc(match.a.name)}</span><strong>${Number(match.scoreA||0)} : ${Number(match.scoreB||0)}</strong><span>${esc(match.b.name)}</span></div>`).join('')}</section>`).join('');
 return `<section class="commerce-ptn-live"><div class="panel live-dashboard-panel"><div class="live-summary-strip"><div class="live-summary-line"><strong class="live-summary-name">${esc(room.name||'票券賽事')}</strong><span class="live-summary-chip">${Number(room.confirmedCount??room.eligibleCount??0)} 人</span><span class="live-summary-chip">已完成 ${done} / ${matches.length} 場</span></div><div class="live-energy-row"><div class="live-energy-track" style="--live-progress:${percent}%"><div class="live-energy-fill"></div><i class="live-energy-tip"></i></div><strong class="live-energy-percent">${percent}%</strong></div></div><div class="live-dashboard-courts"><h3>各台即時戰況</h3><div class="live-court-grid ${stations.length<=1?'live-court-grid-1':''}">${courts||`<div class="empty-state">${room.championName?'冠軍：'+esc(room.championName):'目前沒有可進行的對戰。'}</div>`}</div></div></div></section>`;
}
function ticketRefereePanel(room,pending){
 if(room.phase!=='live')return '<p>賽事尚未開賽；正式開賽並扣券後才能進入裁判台記分。</p>';
 const matches=(room.bracket||[]).filter(match=>match.canScore&&match.a&&match.b);
 const finishes=[['spin','旋轉勝利＋1分'],['knockout','擊飛勝利＋2分'],['burst','爆裂勝利＋2分'],['extreme','極限勝利＋3分']];
 const card=match=>{
  const scoreA=Number(match.scoreA),scoreB=Number(match.scoreB),ready=Math.max(scoreA,scoreB)>=4;
  const sidePanel=side=>{
   const player=match[side.toLowerCase()],score=side==='A'?scoreA:scoreB;
   return `<div class="side-panel ${ready&&score>=(side==='A'?scoreB:scoreA)?'leading':''}"><div class="side-name">${esc(player.name)}</div><div class="side-score">${score}</div><div class="score-btns">${finishes.map(([finish,label])=>`<button type="button" data-action="commerce-ticket-score" data-id="${esc(match.id)}" data-command="score" data-side="${side}" data-finish="${finish}" data-type="${finish}" ${pending||ready?'disabled':''}>${label}</button>`).join('')}</div></div>`;
  };
  return `<article class="panel court-card referee-workstation commerce-ptn-court"><div class="commerce-ptn-court-header"><strong>${match.station?Number(match.station)+' 號台｜':''}第 ${Number(match.round)+1} 輪・第 ${Number(match.seq)+1} 場</strong><span>${ready?'待確認賽果':scoreA+scoreB?'進行中':'等待記分'}</span></div><div class="ref-vs-arena standard">${sidePanel('A')}<div class="ref-vs-mark" aria-hidden="true">VS</div>${sidePanel('B')}</div><div class="btn-row ref-result-actions"><button type="button" class="btn btn-ghost ref-undo-score" data-action="commerce-ticket-score" data-id="${esc(match.id)}" data-command="undo" ${pending||scoreA+scoreB===0?'disabled':''}>撤回上一筆得分</button><button type="button" class="btn btn-primary ref-confirm-result" data-action="commerce-ticket-score" data-id="${esc(match.id)}" data-command="confirm" ${pending||!ready?'disabled':''}>確認比賽結果${ready?`（建議：${esc(scoreA>scoreB?match.a.name:match.b.name)} 勝）`:''}</button></div></article>`;
 };
 return `<h3>合作賽事裁判台</h3><p>房主、房間代理人或最高管理員可記分；每場確認賽果後自動晉級。</p>${room.championName?`<p role="status">賽事已決出冠軍：${esc(room.championName)}</p>`:''}${matches.length?`<div class="court-grid court-grid-1 commerce-ptn-courts">${matches.map(card).join('')}</div>`:'<p>目前沒有可記分的對戰；可至對戰表查看進度。</p>'}`;
}
function ticketPeoplePanel(c,room,pending,drawPanel,delegate){
 const roster=room.participants||[],capacity=Number(room.capacity||0);
 const section=c.peopleSection||'confirmed';
 const nav=[['confirmed','正取',roster.length],['pending','待報到',0],['waitlist','備取／抽籤',null],['tools','新增／同步',null],['staff','工作人員',null],['bracket','賽事編排',null]];
 const subnav=`<nav class="people-subnav" aria-label="人員管理分類">${nav.map(([key,label,count])=>`<button type="button" class="btn ${section===key?'btn-primary':'btn-ghost'}" data-action="commerce-ticket-people-section" data-id="${key}" aria-current="${section===key?'page':'false'}"><strong>${label}</strong>${count!==null?`<span>${count} 人</span>`:''}</button>`).join('')}</nav>`;
 const rows=roster.map((player,i)=>`<tr><td class="people-col-index">${String(i+1).padStart(2,'0')}</td><td class="rank-name people-col-name">${esc(player.name)}</td><td class="people-col-source"><span class="badge badge-neon">線上報名</span></td><td class="people-col-checkin"><span class="badge badge-metal">免報到</span></td><td class="people-col-actions"><details class="people-more-menu"><summary aria-label="${esc(player.name)}的更多操作">⋯</summary><div class="people-more-popover"><div class="people-more-meta">線上報名</div>${room.phase==='waiting'&&player.registrationId?`<button type="button" class="btn btn-danger btn-sm" data-action="commerce-ticket-remove" data-id="${esc(player.registrationId)}" ${pending?'disabled':''}>移除選手</button>`:'<span class="hint">賽事已開賽，名單僅供查看</span>'}</div></details></td></tr>`).join('');
 const rosterPanel=`<div class="panel"><div class="panel-title">正取選手（${roster.length} / ${capacity}）</div>${roster.length?`<div class="table-scroll people-roster-scroll"><table class="rank-table people-roster-table"><thead><tr><th>#</th><th>姓名</th><th>來源</th><th>報到</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-state">目前沒有已報名的選手。</div>'}</div>`;
 const tools=window.BXHRosterView?.controls({contextKey:currentAuthUid()+':'+room.code,section,enabled:section==='confirmed'})||'';
 const panels={confirmed:rosterPanel,pending:'<div class="panel"><div class="panel-title">待報到（0）</div><div class="empty-state">此 PTN 房間目前設定為免報到；線上報名成功即列入正取。</div></div>',waitlist:'<div class="panel"><div class="panel-title">備取／現場抽籤</div><div class="empty-state">這間 PTN 房尚未啟用備取與現場抽籤。</div></div>',tools:`<div class="panel"><div class="panel-title">線上名單同步</div><p class="hint">線上報名會更新正取名單。可手動重新讀取最新房間資料。</p><button type="button" class="btn btn-primary" data-action="commerce-ticket-refresh" ${pending?'disabled':''}>同步最新正取名單</button><p class="hint">積分賽選手須以帳號報名；目前不提供無帳號的現場新增。</p></div>`,staff:delegate||'<div class="panel"><div class="panel-title">工作人員</div><p>目前沒有指定房間代理人。</p></div>',bracket:drawPanel};
 return subnav+`<div id="people-roster-view">${tools}${panels[section]||rosterPanel}</div>`;
}
function ticketHostManagementPanel(c,room,pending,scheduleForm,tab){
 const now=Date.now(),status=room.phase!=='waiting'?'報名已關閉':room.registrationEnabled===false?'已關閉':room.registrationOpenAt>now?'尚未開放':room.registrationCloseAt<=now?'報名已截止':'報名中';
 const roster=room.participants||[];
 const count=Number(room.confirmedCount??room.eligibleCount??0),capacity=Number(room.capacity||0);
 const rosterPanel=`<div class="panel"><div class="panel-title">正取名單（${count} / ${capacity}）</div>${roster.length?`<div class="table-scroll"><table class="rank-table"><thead><tr><th>#</th><th>選手</th><th>來源</th>${room.phase==='waiting'?'<th>操作</th>':''}</tr></thead><tbody>${roster.map((player,i)=>`<tr><td>${String(i+1).padStart(2,'0')}</td><td class="rank-name">${esc(player.name)}</td><td><span class="badge badge-neon">線上報名</span></td>${room.phase==='waiting'?`<td><button type="button" class="btn btn-ghost btn-sm" data-action="commerce-ticket-remove" data-id="${esc(player.registrationId)}" ${pending?'disabled':''}>移除</button></td>`:''}</tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">目前沒有已報名的選手。</div>'}${room.phase!=='waiting'?'<p class="hint">賽事已開賽，名單僅供查看。</p>':''}</div>`;
 const registrationPanel=`<div class="panel"><div class="panel-title">報名資訊</div><div class="grid grid-3"><div class="stat-box"><div class="label">報名狀態</div><div class="value small">${esc(status)}</div></div><div class="stat-box"><div class="label">正取</div><div class="value small">${count} / ${capacity}</div></div><div class="stat-box"><div class="label">抽籤</div><div class="value small">${room.drawId?room.drawReady===false?'需重抽':'已完成':'尚未抽籤'}</div></div></div><p class="hint">報名開放：${date(room.registrationOpenAt)}<br>報名截止：${date(room.registrationCloseAt)}（台灣時間）</p>${status==='報名已截止'&&room.phase==='waiting'?'<div class="banner warn">報名已截止；請至「合作主辦設定」調整時間後再請玩家報名。</div>':''}</div>`;
 const drawPanel=`<div class="panel"><div class="panel-title">抽籤與開賽</div><p class="hint">可出賽 ${Number(room.eligibleCount||0)} 人｜${room.drawId?(room.drawReady===false?'名單已變更，請重新抽籤':'已抽籤'):'尚未抽籤'}</p>${room.ticketStatus==='consumed'?'<div class="banner">啟動券已扣用。</div>':room.ticketStatus==='reserved'?'<div class="banner">啟動券已綁定，正式開賽時扣用。</div>':''}${room.phase==='waiting'?`<div class="btn-row"><button class="btn btn-ghost" data-action="commerce-ticket-draw" ${pending||room.eligibleCount<2?'disabled':''}>${room.drawId?'重新抽籤':'抽籤'}</button><button class="btn btn-primary" data-action="commerce-ticket-start" ${pending||!room.drawId||room.drawReady===false||room.eligibleCount<2?'disabled':''}>正式開賽並扣券</button></div>`:'<p class="hint">此賽事已離開候賽階段。</p>'}${ticketForfeitPanel(room,pending)}</div>`;
 const delegate=room.canAssignDelegate?`<div class="panel"><div class="panel-title">房間代理人（最多一名）</div><p>目前代理人：${room.delegateUid?`${esc(room.delegateName||'未設定姓名')}（${esc(room.delegateGameId||'未設定遊戲 ID')}）`:'尚未指定'}</p><form data-commerce-form="ticket-delegate-search">${input('query','搜尋本名或遊戲 ID','','text','minlength="2" maxlength="80" required')}<button class="btn btn-primary" ${pending?'disabled':''}>搜尋帳號</button></form>${c.delegateSearch?.code===room.code?`<p>搜尋「${esc(c.delegateSearch.query)}」：${c.delegateSearch.players.length} 筆結果</p><ul>${c.delegateSearch.players.map((player,i)=>`<li>${esc(player.name)}（${esc(player.gameId||'未設定遊戲 ID')}） <button type="button" class="btn btn-ghost" data-action="commerce-ticket-select-delegate" data-id="${i}" ${pending?'disabled':''}>選為代理人</button></li>`).join('')}</ul>`:''}${room.delegateUid?`<button class="btn btn-ghost" data-action="commerce-ticket-revoke-delegate" ${pending?'disabled':''}>撤銷代理權</button>`:''}</div>`:room.delegateUid?`<div class="panel"><div class="panel-title">房間代理人</div><p>${esc(room.delegateName||'未設定姓名')}（${esc(room.delegateGameId||'未設定遊戲 ID')}）</p></div>`:'';
 const settings=`<div class="panel"><div class="panel-title">合作主辦設定</div><div class="grid grid-2"><div class="stat-box"><div class="label">賽事名稱</div><div class="value small">${esc(room.name)}</div></div><div class="stat-box"><div class="label">場地</div><div class="value small">${esc(room.location||'未設定')}</div></div></div>${scheduleForm||'<p class="hint">開賽後不能調整報名時間。</p>'}</div>${delegate}`;
 const operations=`<div class="panel"><div class="panel-title">賽事操作</div><p class="hint">合作積分賽由系統在所有對戰與名次確認後自動結算。請於「對戰表」確認賽果，並在房間結束後核對積分入帳。</p>${room.phase==='live'&&room.championName?'<div class="banner warn">冠軍已產生，正在等待自動結算；請重新整理房間確認狀態。</div>':''}</div>`;
 const content=tab==='settings'?settings:tab==='people'?ticketPeoplePanel(c,room,pending,drawPanel,delegate):tab==='registrations'?`${registrationPanel}${rosterPanel}${drawPanel}`:tab==='bracket'?ticketBracketPanel(room):tab==='live'?ticketLivePanel(room):tab==='referee'?ticketRefereePanel(room,pending):operations;
 return `<section class="commerce commerce-ptn-management"><div class="panel-title"><button type="button" class="btn btn-ghost" data-action="commerce-ticket-back">← 返回賽事管理／切換房間</button><button class="btn btn-ghost btn-sm" data-action="commerce-ticket-refresh" ${c.loading?'disabled':''}>重新整理房間</button></div>${notices(c)}${c.loading?'<p role="status">正在讀取房間資料……</p>':''}${content}</section>`;
}
function ticketManagedTab(tab){
 const c=context();
 if(!c.roomManageOpen||!ticketManagementView(c)||!['registrations','settings','people','live','bracket','referee','operations'].includes(tab))return null;
 schedule('ticket-room-state',c.ticketRoom===null);
 const room=c.ticketRoom;
  if(room?.ok!==true||room.code!==c.ownedPtn.code)return `<section class="panel commerce"><button type="button" class="btn btn-ghost" data-action="commerce-ticket-back">← 返回賽事管理／切換房間</button><h2>管理房間</h2>${notices(c)}<p role="status">${c.loading?'正在驗證票券房管理權限並讀取賽事……':'房間尚未通過管理權限驗證，請返回賽事管理重新接管。'}</p></section>`;
 const pending=c.loading||c.busy||!!c.pending;
 const scheduleForm=room.phase==='waiting'&&['registrationOpenAt','registrationCloseAt','startAt'].every(key=>Number.isSafeInteger(room[key]))?`<details open><summary>調整報名與開賽時間</summary><form data-commerce-form="ticket-schedule"><p>時間以台灣時間填寫；報名截止與預定開賽必須在未來。</p>${['registrationOpenAt','registrationCloseAt','startAt'].map((key,i)=>input(key,['報名開放','報名截止','預定開賽'][i]+'（台灣時間）',c.scheduleDraft?.[key]||new Date(room[key]+8*3600000).toISOString().slice(0,16),'datetime-local','required')).join('')}<button class="btn btn-primary" ${pending?'disabled':''}>儲存賽事時間</button></form></details>`:'';
 return ticketHostManagementPanel(c,room,pending,scheduleForm,tab);
}
function ticketRoomPanel(c){
 const back=`<button class="btn btn-ghost" data-action="commerce-ticket-back">${ticketManagementView(c)?'返回賽事管理':ticketCreationView(c)?'返回選券':'返回我的啟動券'}</button>`;
 const pending=c.loading||c.busy||!!c.pending;
 if(c.ticketDraft){
  const {ticket,...v}=c.ticketDraft;
  const time=(key,label)=>input(key,label,v[key],'datetime-local','data-minute-precision="true" required');
  return `<section class="panel commerce">${back}<h2>選券建房</h2>${notices(c)}<p>${ptnCreation(c)?'建立時自動產生 PTN 房號':'房號 '+esc(pilotCode())}｜正取上限 ${Number(ticket.capacity)} 人</p><form data-commerce-form="ticket-room">${input('name','賽事名稱',v.name,'text','maxlength="80" required')}${input('location','場地',v.location,'text','maxlength="160"')}${input('stations','裁判台數',v.stations||1,'number','min="1" max="12" step="1" required')}${time('registrationOpenAt','報名開放（台灣時間）')}${time('registrationCloseAt','報名截止（台灣時間）')}${time('startAt','預定開賽（台灣時間）')}<button class="btn btn-primary" ${pending?'disabled':''}>建立房間並綁券</button></form></section>`;
 }
 const room=c.ticketRoom;
 const scheduleForm=room&&ticketManagementView(c)&&room.phase==='waiting'&&['registrationOpenAt','registrationCloseAt','startAt'].every(key=>Number.isSafeInteger(room[key]))?`<details><summary>調整報名與開賽時間</summary><form data-commerce-form="ticket-schedule"><p>時間以台灣時間填寫；報名截止與預定開賽必須在未來。</p>${['registrationOpenAt','registrationCloseAt','startAt'].map((key,i)=>input(key,['報名開放','報名截止','預定開賽'][i]+'（台灣時間）',c.scheduleDraft?.[key]||new Date(room[key]+8*3600000).toISOString().slice(0,16),'datetime-local','required')).join('')}<button class="btn btn-primary" ${pending?'disabled':''}>儲存賽事時間</button></form></details>`:'';
 if(room&&ticketManagementView(c)&&c.roomManageOpen)return ticketHostManagementPanel(c,room,pending,scheduleForm,'registrations');
 return `<section class="commerce commerce-ptn-management"><div class="panel-title">${back}<button class="btn btn-ghost btn-sm" data-action="commerce-ticket-refresh" ${c.loading?'disabled':''}>重新整理賽事</button></div>${notices(c)}${c.loading?'<div class="panel" role="status">正在驗證票券房管理權限並讀取賽事……</div>':''}${room?`<div class="panel"><div class="ptn-room-card-heading"><h2>${esc(room.name)}</h2><span class="badge ${room.phase==='live'?'badge-neon':'badge-metal'}">${room.phase==='waiting'?'等待開賽':room.phase==='live'?'比賽中':room.phase==='done'?'已結束':'賽事狀態待確認'}</span></div><div class="grid grid-3"><div class="stat-box"><div class="label">房號</div><div class="value small">${esc(room.code)}</div></div><div class="stat-box"><div class="label">正取</div><div class="value small">${Number(room.confirmedCount??room.eligibleCount??0)} / ${Number(room.capacity||0)} 人</div></div><div class="stat-box"><div class="label">場地</div><div class="value small">${esc(room.location||'未設定')}</div></div></div>${room.ticketStatus==='consumed'?'<div class="banner">已扣用 1 張啟動券</div>':room.ticketStatus==='reserved'?'<div class="banner">已綁定啟動券，開賽時扣用。</div>':''}<p class="hint">可出賽 ${Number(room.eligibleCount||0)} 人｜${room.drawId?(room.drawReady===false?'名單已變更，請重新抽籤':'已抽籤'):'尚未抽籤'}</p>${ticketManagementView(c)?`<button class="btn btn-primary" data-action="commerce-ticket-open-manage" ${pending?'disabled':''}>管理房間</button>`:''}</div>${!ticketManagementView(c)&&room.phase==='waiting'?`<div class="panel"><div class="panel-title">抽籤與開賽</div><div class="btn-row"><button class="btn btn-ghost" data-action="commerce-ticket-draw" ${pending||room.eligibleCount<2?'disabled':''}>${room.drawId?'重新抽籤':'抽籤'}</button><button class="btn btn-primary" data-action="commerce-ticket-start" ${pending||!room.drawId||room.drawReady===false||room.eligibleCount<2?'disabled':''}>正式開賽並扣券</button></div>${room.participants?.length?`<details><summary>管理參賽名單（${room.participants.length} 人）</summary><ul>${room.participants.map(player=>`<li>${esc(player.name)} <button type="button" class="btn btn-ghost" data-action="commerce-ticket-remove" data-id="${esc(player.registrationId)}" ${pending?'disabled':''}>移除</button></li>`).join('')}</ul></details>`:''}</div>`:''}${!ticketManagementView(c)?ticketForfeitPanel(room,pending):''}`:''}</section>`;
}
function ticketManagementContext(){
 const c=context();
 if(!ticketManagementView(c))return null;
 const room=c.ticketRoom;
 return room?.ok===true&&room.code===ticketRoomCode(c)
  ?{code:room.code,phase:room.phase,verified:true}
  :{code:c.ownedPtn.code,verified:false};
}

async function discoverOwnedPtn(){
 const c=context();
 if(!currentAuthUid()||!canSeeTickets()||!inManagement()||c.ownedPtn?.loading)return;
 const loading={loading:true};
 c.ownedPtn=loading;
 try{
  const result=await call({action:'ticket-ptn-status'});
  if(c===context()&&c.ownedPtn===loading)c.ownedPtn={code:isPtnCode(result.code)?result.code:null};
 }catch(error){
  if(c===context()&&c.ownedPtn===loading){
   const message=String(error?.message||'');
   const failed=!message.includes('permission-denied')||message.includes('app-check-unavailable');
   c.ownedPtn={failed,error:failed?ticketRoomReadError(error):''};
  }
 }finally{
  if(c===context()&&canSeeTickets()&&inManagement())render();
 }
}
function ptnRoomCodes(c){
 return [...new Set([c.ownedPtn?.code,...(c.tickets||[]).map(ticket=>ticket.boundRoomCode)].filter(isPtnCode))];
}
async function loadPtnRoomCards(){
 const c=context();
 if(c.ptnRoomCardLoading||!canSeeTickets()||!inManagement()||c.view==='ticket-manage')return;
 const codes=ptnRoomCodes(c).slice(0,c.ptnRoomLimit).filter(code=>!c.ptnRoomCards[code]);
 if(!codes.length)return;
 c.ptnRoomCardLoading=true;
 codes.forEach(code=>{c.ptnRoomCards[code]={loading:true};});
 render();
 const results=await Promise.allSettled(codes.map(code=>call({action:'ticket-room-state',code})));
 if(c!==context())return;
 results.forEach((result,i)=>{
  const code=codes[i];
  c.ptnRoomCards[code]=result.status==='fulfilled'&&result.value?.code===code
   ?{room:result.value}:{error:true};
 });
 c.ptnRoomCardLoading=false;
 if(inManagement()&&c.view!=='ticket-manage')render();
}
function schedulePtnRoomCards(c){
 if(c.tickets===null||c.ptnRoomCardScheduled||c.ptnRoomCardLoading||!canSeeTickets()||!inManagement()||!ptnRoomCodes(c).slice(0,c.ptnRoomLimit).some(code=>!c.ptnRoomCards[code]))return;
 c.ptnRoomCardScheduled=true;
 setTimeout(()=>{
  c.ptnRoomCardScheduled=false;
  if(c===context())void loadPtnRoomCards();
 },0);
}
function ptnRoomCard(code,c){
 const snapshot=c.ptnRoomCards[code],room=snapshot?.room;
 const capacity=Number(room?.capacity||c.tickets?.find(ticket=>ticket.boundRoomCode===code)?.capacity||0);
 const count=Number.isSafeInteger(room?.confirmedCount)?room.confirmedCount:Number.isSafeInteger(room?.eligibleCount)?room.eligibleCount:null;
 const phase=room?.phase==='live'?'進行中':room?.phase==='done'?'已結束':room?.phase==='cancelled'?'已取消':room?.phase==='waiting'?'尚未開始':snapshot?.error?'資料待確認':'讀取中';
 const registration=room?.phase==='waiting'?(room.registrationEnabled===false?'報名已關閉':room.registrationOpenAt>Date.now()?'即將開放':room.registrationCloseAt<=Date.now()?'報名已關閉':'報名中'):'報名已關閉';
 return `<div class="panel tournament-management-card ptn-room-card" style="margin:0;">
  <div class="ptn-room-card-heading"><strong>${esc(room?.name||'票券賽事')}</strong><span class="badge ${room?.phase==='live'?'badge-neon':'badge-metal'}">${esc(phase)}</span></div>
  <div class="hint" style="margin-top:6px;overflow-wrap:anywhere;">房號 ${esc(code)}${room?.location?'｜'+esc(room.location):''}</div>
  <div class="hint" style="margin-top:6px;">正取 ${count===null?'—':count}${capacity?' / '+capacity:''} 人｜${room?esc(registration):'資料讀取中'}</div>
  ${snapshot?.error?'<div class="hint" role="status">房間摘要暫時無法讀取，仍可進入房間重試。</div>':''}
  <div class="btn-row" style="margin-top:10px;"><button type="button" class="btn btn-primary btn-sm" data-action="commerce-open-ticket-room" data-id="${esc(code)}">進入管理</button></div>
 </div>`;
}
function ownedTicketRoomCard(){
 if(!canManagePtn()||!inManagement()||!currentAuthUid())return '';
 const c=context();
  if(!c.ownedPtn&&canSeeTickets()){
  setTimeout(()=>{if(c===context()&&!c.ownedPtn)void discoverOwnedPtn();},0);
 }
  if(canSeeTickets())schedule('my-tickets',c.tickets===null);
  if(canSeeTickets())schedulePtnRoomCards(c);
  const rooms=ptnRoomCodes(c);
  return `<section class="panel ptn-room-management"><div class="panel-title"><span>PTN 合作賽事管理</span>${canSeeTickets()?`<button type="button" class="btn btn-ghost btn-sm" data-action="commerce-refresh-ptn-rooms">重新整理</button>`:''}</div><div class="hint">每次顯示最多 5 間房間；選擇小卡即可進入管理。</div>${c.ownedPtn?.failed?`<p role="alert">${esc(c.ownedPtn.error)}</p><button class="btn btn-ghost" data-action="commerce-refresh-owned-ptn">重新查詢</button>`:''}${rooms.length?`<div class="ptn-room-cards">${rooms.slice(0,c.ptnRoomLimit).map(code=>ptnRoomCard(code,c)).join('')}</div>${rooms.length>c.ptnRoomLimit?`<button type="button" class="btn btn-ghost" data-action="commerce-more-ptn-rooms">再載入 5 間</button>`:''}`:c.tickets===null||c.ownedPtn?.loading?'<p role="status">正在讀取房間……</p>':'<p class="hint">目前沒有已綁券的房間。</p>'}<details class="ptn-room-code-entry"><summary>依房號接管其他 PTN 房間</summary><form data-commerce-form="ticket-open-code">${input('code','代理或最高管理員接管 PTN 房號',c.ptnCodeDraft||'','text','placeholder="PTN-XXXXXX" maxlength="10" required')}<button class="btn btn-ghost">依房號接管</button></form><p class="hint">只有開房者、該房代理人及 BXH 最高管理員可通過管理權限驗證。</p></details></section>`;
}
function ticketCreationPage(){
 const c=context();
 if(ticketManagementView(c)){
  schedule('ticket-room-state',c.ticketRoom===null);
  return ticketRoomPanel(c);
 }
 if(!ticketPilot()||!ticketCreationView(c))return null;
 if(c.ticketRoomOpen){
  schedule('ticket-room-state',!c.ticketDraft&&c.ticketRoom===null);
  return ticketRoomPanel(c);
 }
 const ptn=ptnCreation(c);
 if(ptn&&!c.ptnStatus)schedule('ticket-ptn-status',true);
 else schedule('my-tickets',c.tickets===null);
 const bound=ptn?isPtnCode(c.ptnStatus?.code):c.tickets?.some(ticket=>ticket.boundRoomCode===pilotCode());
 const locked=c.loading||c.busy||!!c.pending;
 const options=ticketPreviews.map(({capacity})=>{
  const available=(c.tickets||[]).filter(ticket=>ticket.capacity===capacity&&ticketAvailable(ticket));
  const first=available.sort((a,b)=>a.expiresAt-b.expiresAt)[0];
  const enabled=first&&(!bound||ptn)&&!locked&&(!ptn||c.ptnStatus?.ok===true&&c.ptnStatus.canCreate!==false);
  const status=c.tickets===null?'尚未取得持有狀態':available.length?`可用 ${available.length} 張`:'無可用票券';
  return `<button class="panel commerce-category btn ${enabled?'btn-primary':'btn-ghost'}" data-action="commerce-ticket-bind" data-id="${esc(first?.id||'')}" ${enabled?'':'disabled'}><strong>${capacity} 人</strong><span>${status}</span></button>`;
 }).join('');
 return `<section class="commerce"><div class="panel-title"><h2>新增賽事｜選券建房</h2><button class="btn btn-ghost" data-action="commerce-close-ticket-create">返回賽事管理</button></div>${notices(c)}${c.loading?'<p role="status">正在讀取啟動券……</p>':''}<div class="commerce-grid">${options}</div>${bound?`<p>${ptn?'最近建立的 PTN 房間｜'+esc(ticketRoomCode(c)):'此試點房已建立'}。</p><button class="btn btn-primary" data-action="commerce-ticket-room" ${locked?'disabled':''}>管理已建立的賽事</button>`:''}<button class="btn btn-ghost" data-action="commerce-refresh-tickets" ${locked?'disabled':''}>重新整理票券</button></section>`;
}

function shop(){
 const c=enter('shop');
 if(!canSeeTickets()){
  c.ticketsOpen=false;c.tickets=null;c.ticketRoomOpen=false;c.ticketRoom=null;c.ticketDraft=null;
 }
 if(c.ticketsOpen){
  if(ticketPilot()&&c.ticketRoomOpen){schedule('ticket-room-state',!c.ticketDraft&&c.ticketRoom===null);return ticketRoomPanel(c);}
  schedule('my-tickets',c.tickets===null);return ticketWallet(c);
 }
 schedule('catalog',c.products===null);
 if(c.order)return orderDetail(c.order,c,false);
 if(c.category&&c.category!=='all'&&!storefrontKindVisible(c.category))c.category='';
 const p=visibleProducts(c).find(p=>p.id===c.productId);
 let body;
 if(p)body=productDetails(p,c);
 else if(!c.category)body=`<div class="commerce-grid">${[['all','全部商品'],...Object.entries(kinds).filter(([id])=>storefrontKindVisible(id))].map(([id,name])=>`<button class="panel commerce-category" data-action="commerce-category" data-id="${id}"><strong>${name}</strong><span>查看商品 →</span></button>`).join('')}</div>`;
 else body=`<button class="btn btn-ghost" data-action="commerce-categories">返回商品分類</button>${c.category==='ticket'?'<button class="btn btn-ghost" data-action="commerce-open-tickets">我的啟動券</button>':''}<h3>${esc(kinds[c.category]||'全部商品')}</h3><div class="commerce-grid">${visibleProducts(c).filter(p=>c.category==='all'||p.delivery.kind===c.category).map(p=>`<article class="panel commerce-card${p.delivery.kind==='ticket'?' commerce-ticket-card':''}">${image(p.imageUrl)?`<img src="${esc(image(p.imageUrl))}" alt="${esc(p.name)}" loading="lazy">`:''}<span class="hint">${esc(kinds[p.delivery.kind])}</span><h3>${esc(p.name)}</h3><strong class="commerce-price">${money(p.priceTwd)}</strong>${p.previewOnly?'<p class="commerce-ticket-status">尚未開放購買</p>':p.delivery.kind==='ticket'?'<p class="hint">合作主辦限定</p>':''}<button class="btn btn-ghost" data-action="commerce-product" data-id="${esc(p.id)}">查看商品</button></article>`).join('')||'<div class="empty-state">此分類目前沒有上架商品。</div>'}</div>${c.productsCursor?'<button class="btn btn-ghost" data-action="commerce-products-more">載入更多商品</button>':''}`;
 return `<section class="commerce"><div class="panel-title"><h2>商城</h2><button class="btn btn-ghost" data-action="commerce-refresh-products">重新整理</button></div>${notices(c)}${c.storeOpen===false?'<p class="banner" role="status">商城準備中，目前尚未開放購買。</p>':''}${c.loading?'<p role="status">正在讀取商品……</p>':''}${body}</section>`;
}
function orderList(c,adminMode){return `${adminMode?`<label>付款狀態<select data-commerce-status>${[['reported','待對帳'],['pending','待付款'],['paid','已確認收款'],['refund_pending','退款處理中'],['refunded','已退款'],['cancelled','已取消'],['','全部']].map(([id,l])=>`<option value="${id}" ${c.status===id?'selected':''}>${l}</option>`).join('')}</select></label>`:''}<div class="commerce-orders">${(c.orders||[]).map(o=>`<button class="panel commerce-order" data-action="commerce-order" data-id="${esc(o.id)}"><span><strong>${esc(o.productSnapshot.name)}</strong><small>${esc(o.id)}<br>${date(o.createdAt)}${adminMode?'<br>'+esc(o.buyerName):''}</small></span><span><strong>${money(o.amountTwd)}</strong><small>${esc(paymentLabels[o.paymentStatus])}<br>${esc(deliveryLabels[o.deliveryStatus])}</small></span></button>`).join('')||'<div class="empty-state">目前沒有訂單。</div>'}</div>${c.ordersCursor?'<button class="btn btn-ghost" data-action="commerce-orders-more">載入更多訂單</button>':''}`;}
function orderDetail(o,c,adminMode){
 const pending=['pending','reported'].includes(o.paymentStatus),expired=o.paymentStatus==='pending'&&o.expiresAt<=Date.now(),draft=c.formDrafts[o.id]||{};
 return `<section class="panel commerce"><div class="panel-title"><h2>訂單詳情</h2><button class="btn btn-ghost" data-action="commerce-back-orders">返回</button></div>${notices(c)}<h3>${esc(o.productSnapshot.name)}</h3><p class="hint">${esc(o.id)}${adminMode?'<br>買家：'+esc(o.buyerName)+'（'+esc(o.ownerUid)+'）':''}</p><dl class="commerce-facts"><dt>應付金額</dt><dd>${money(o.amountTwd)}</dd><dt>付款狀態</dt><dd>${esc(paymentLabels[o.paymentStatus])}</dd><dt>交付狀態</dt><dd>${esc(deliveryLabels[o.deliveryStatus])}</dd><dt>成立時間</dt><dd>${date(o.createdAt)}</dd><dt>付款期限</dt><dd>${date(o.expiresAt)}（台灣時間）</dd></dl><details><summary>購買時的商品內容與說明</summary><p class="commerce-copy">${esc(o.productSnapshot.description)}\n${esc(o.productSnapshot.terms)}</p></details>${pending&&!expired?`<div class="commerce-bank"><h3>銀行轉帳資訊</h3><p>${esc(o.bankSnapshot.bankName)}（${esc(o.bankSnapshot.bankCode)}） ${esc(o.bankSnapshot.branch)}<br>戶名：${esc(o.bankSnapshot.accountName)}<br>帳號：<strong>${esc(o.bankSnapshot.accountNumber)}</strong><br>金額：${money(o.amountTwd)}</p></div>`:''}${o.reviewNote?`<p class="commerce-error">BXH 提醒：${esc(o.reviewNote)}</p>`:''}${o.report?`<p>已回報：末五碼 ${esc(o.report.lastFive)}｜${date(o.report.transferredAt)}<br>${esc(o.report.note)}</p>`:''}${expired&&!adminMode?'<p class="commerce-error">付款期限已過，請勿再轉帳；若已完成匯款，請聯絡 BXH 並提供訂單編號。</p>':''}${o.paymentStatus==='pending'&&!expired&&!adminMode?`<form data-commerce-form="report"><h3>已轉帳，回報付款</h3><label>匯款帳號末五碼<input name="lastFive" value="${esc(draft.report?.lastFive||'')}" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required></label><label>轉帳時間（台灣時間）<input name="transferredAt" value="${esc(draft.report?.transferredAt||'')}" type="datetime-local" data-minute-precision="true" required></label><label>備註（選填）<textarea name="note" maxlength="300">${esc(draft.report?.note||'')}</textarea></label><p class="hint">回報後由 BXH 核對銀行入帳。逾期已轉帳，請聯絡 BXH 並提供訂單編號。</p><button class="btn btn-primary" ${c.busy||c.pending?'disabled':''}>送出匯款資料</button><button type="button" class="btn btn-ghost" data-action="commerce-cancel" ${c.busy||c.pending?'disabled':''}>取消未付款訂單</button></form>`:''}${o.paymentStatus==='reported'&&!adminMode?'<p role="status">匯款資料已送出，等待 BXH 核對。</p>':''}${o.paymentStatus==='paid'&&o.deliveryStatus!=='delivered'&&!adminMode?'<p role="status">已確認收款，商品交付處理中，無須再次付款。</p>':''}${o.paidAt?'<p class="hint">確認收款：'+date(o.paidAt)+'</p>':''}${o.deliveredAt?'<p class="hint">成功交付：'+date(o.deliveredAt)+'</p>':''}${adminMode?adminOrderControls(o,c):''}<button class="btn btn-ghost" data-action="commerce-refresh-order">更新訂單狀態</button></section>`;
}
function adminOrderControls(o,c){
 const locked=c.busy||!!c.pending,draft=c.formDrafts[o.id]||{};
 return `${o.deliveryError?'<p class="commerce-error">交付原因：'+esc(errorMessage(o.deliveryError))+'</p>':''}${['pending','reported'].includes(o.paymentStatus)?`<form data-commerce-form="confirm"><h3>核對銀行實際入帳</h3><label>實收金額<input type="number" name="receivedAmountTwd" value="${esc(draft.confirm?.receivedAmountTwd||'')}" min="1" step="1" required></label><label>銀行交易識別碼<input name="paymentReference" value="${esc(draft.confirm?.paymentReference||'')}" maxlength="120" required placeholder="銀行交易序號；同筆入帳固定使用相同識別碼"></label><p class="hint">請在銀行 App／網銀核實入帳。不得只憑付款截圖確認；少付、多付或重複匯款請先釐清。</p><button class="btn btn-primary" ${locked?'disabled':''}>確認收款並交付</button></form><form data-commerce-form="request-info"><label>請玩家補充或更正資料<textarea name="note" maxlength="300" required>${esc(draft['request-info']?.note||'')}</textarea></label><button class="btn btn-ghost" ${locked?'disabled':''}>退回補充資料（延長 24 小時）</button></form>`:''}${o.paymentStatus==='paid'?`<p class="hint">確認人：${esc(o.confirmedBy)}｜銀行識別碼：${esc(o.paymentReference)}</p>${o.deliveryStatus!=='delivered'?`<button class="btn btn-primary" data-action="commerce-deliver" ${locked?'disabled':''}>重試交付</button>`:''}<form data-commerce-form="refund-start"><h3>全額退款處理</h3><p class="hint">先收回未使用權益，再到銀行退款；完成匯款後回來登記。已使用或有後續異動需另行評估。</p><label>退款原因<textarea name="note" maxlength="500" required>${esc(draft['refund-start']?.note||'')}</textarea></label><button class="btn btn-danger" ${locked?'disabled':''}>收回權益並開始退款</button></form>`:''}${o.paymentStatus==='refund_pending'?`<form data-commerce-form="refund-complete"><h3>登記已完成銀行退款</h3><label>實際退款金額<input name="refundedAmountTwd" value="${esc(draft['refund-complete']?.refundedAmountTwd||'')}" type="number" min="1" step="1" required></label><label>退款交易識別碼<input name="refundReference" value="${esc(draft['refund-complete']?.refundReference||'')}" maxlength="120" required></label><button class="btn btn-primary" ${locked?'disabled':''}>確認已全額退款</button></form>`:''}`;
}
function orders(){const c=enter('orders');if(c.order)return orderDetail(c.order,c,false);schedule('my-orders',c.orders===null);return `<section class="commerce"><div class="panel-title"><h2>我的訂單</h2><button class="btn btn-ghost" data-action="commerce-refresh-orders">重新整理</button></div>${notices(c)}${c.loading?'<p role="status">正在讀取訂單……</p>':''}${orderList(c,false)}</section>`;}
const input=(name,label,value,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value??'')}" ${extra}></label>`;
function productForm(c){const p=c.draft;if(!p)return '<button class="btn btn-primary" data-action="commerce-new-product">新增商品草稿</button>';
 return `<form data-commerce-form="product"><h3>${p.version?'編輯商品':'新增商品草稿'}</h3><p class="hint">商品代碼：${esc(p.id)}｜版本 ${p.version||0}</p>${input('name','商品名稱',p.name,'text','maxlength="80" required')}${input('imageUrl','照片網址（HTTPS）',p.imageUrl,'url','required')}<label>商品說明<textarea name="description" maxlength="4000" required>${esc(p.description)}</textarea></label><div class="commerce-grid">${input('priceTwd','價格（新臺幣）',p.priceTwd,'number','min="1" step="1" required')}<label>交付類型<select name="kind">${Object.entries(kinds).map(([id,l])=>`<option value="${id}" ${p.delivery.kind===id?'selected':''}>${l}</option>`).join('')}</select></label>${input('assetId','權益／道具代碼（啟動券填人數）',p.delivery.assetId,'text','pattern="[A-Za-z0-9_-]{1,128}" required')}${input('quantity','數量',p.delivery.quantity,'number','min="1" max="10000" step="1" required')}${input('durationDays','有效天數（永久填 0；VIP 必填正數）',p.delivery.durationDays,'number','min="0" max="3650" step="1" required')}${input('sort','排序',p.sort,'number','min="0" max="10000" step="1" required')}</div><label>購買資格<select name="audience"><option value="all" ${p.audience==='all'?'selected':''}>一般會員</option><option value="signed_organizer" ${p.audience==='signed_organizer'?'selected':''}>有效簽約活動主辦</option><option value="partner_organizer" ${p.audience==='partner_organizer'?'selected':''}>有效合作主辦</option></select></label><label>購買說明與退款處理方式<textarea name="terms" maxlength="2000" required>${esc(p.terms)}</textarea></label><label>狀態<select name="status">${[['draft','草稿'],['published','上架'],['disabled','下架']].map(([id,l])=>`<option value="${id}" ${p.status===id?'selected':''}>${l}</option>`).join('')}</select></label><p class="hint">交付類型必須通過後端功能串接驗證才能上架。場次商品僅限有效簽約主辦。啟動券請設定合作主辦限定、數量 1、有效天數 0。</p><button class="btn btn-primary" ${c.busy||c.pending?'disabled':''}>儲存商品</button><button type="button" class="btn btn-ghost" data-action="commerce-new-product">新增另一項</button></form>`;}
function configForm(c){const v=c.configDraft;if(!v)return '<p role="status">正在讀取收款設定……</p>';
 return `<form data-commerce-form="config"><h3>收款設定</h3><p class="hint">變更帳戶只影響新訂單，既有訂單保留原匯款資訊。</p><label><input name="enabled" type="checkbox" ${v.enabled?'checked':''}> 開放建立訂單</label><div class="commerce-grid">${input('bankCode','銀行代碼',v.bankCode,'text','pattern="[0-9]{3}" required')}${input('bankName','銀行名稱',v.bankName,'text','required')}${input('branch','分行',v.branch,'text','required')}${input('accountName','戶名',v.accountName,'text','required')}${input('accountNumber','銀行帳號',v.accountNumber,'text','required')}${input('paymentHours','付款期限（小時）',v.paymentHours,'number','min="1" max="168" step="1" required')}</div><button class="btn btn-primary" ${c.busy||c.pending?'disabled':''}>儲存設定</button></form>`;
}
function adminPage(){
 if(!isSuperAdmin())return '<section class="panel">目前身分沒有商城管理權限。</section>';
 const c=enter('admin');if(c.order)return orderDetail(c.order,c,true);
 schedule(c.adminZone==='products'?'admin-products':c.adminZone==='config'?'admin-config':'admin-orders',c.adminZone==='products'?c.products===null:c.adminZone==='config'?c.configDraft===null:c.orders===null);
 return `<section class="commerce"><h2>商城管理</h2><nav class="btn-row">${[['orders','訂單與對帳'],['products','商品管理'],['config','收款設定']].map(([id,l])=>`<button class="btn ${c.adminZone===id?'btn-primary':'btn-ghost'}" data-action="commerce-admin-zone" data-id="${id}">${l}</button>`).join('')}</nav>${notices(c)}<button class="btn btn-ghost" data-action="commerce-admin-refresh">重新整理</button>${c.loading?'<p role="status">讀取中……</p>':''}${c.adminZone==='config'?configForm(c):c.adminZone==='products'?`${productForm(c)}<div class="commerce-orders">${(c.products||[]).map(p=>`<button class="panel commerce-order" data-action="commerce-edit-product" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><span>${money(p.priceTwd)}｜${esc(({draft:'草稿',published:'上架',disabled:'下架'})[p.status])}</span></button>`).join('')}</div>${c.productsCursor?'<button class="btn btn-ghost" data-action="commerce-products-more">載入更多商品</button>':''}`:orderList(c,true)}</section>`;
}
async function readOrder(id){const c=context();if(c.loading||c.busy)return;const generation=++c.generation;c.loading=true;c.error='';render();try{const r=await call({action:'order-detail',orderId:id});if(c===context()&&generation===c.generation)c.order=r.order;}catch(e){if(c===context()&&generation===c.generation)c.error=errorMessage(e);}finally{if(c===context()&&generation===c.generation){c.loading=false;render();}}}
async function handle(action,target){
 const c=context(),adminMode=typeof activeTab!=='undefined'&&activeTab==='commerce-admin'&&isSuperAdmin();
 if(c.busy||c.loading)return;
 const id=target?.dataset?.id;
 if(action==='commerce-ticket-people-section'&&ticketManagementView(c)&&c.roomManageOpen){
  if(['confirmed','pending','waitlist','tools','staff','bracket'].includes(id)){
   c.peopleSection=id;render();
  }
  return;
 }
 if(action==='commerce-refresh-owned-ptn')return discoverOwnedPtn();
 if(action==='commerce-refresh-ptn-rooms'&&canSeeTickets()&&inManagement()){c.ptnRoomCards={};c.tickets=null;return load('my-tickets');}
 if(action==='commerce-more-ptn-rooms'&&canSeeTickets()&&inManagement()){c.ptnRoomLimit+=5;render();return;}
 if(action==='commerce-open-owned-ptn'){
  if(!canManagePtn()||!inManagement()||!isPtnCode(c.ownedPtn?.code))return;
  enter('ticket-manage');
  c.ticketRoomOpen=true;
  return load('ticket-room-state');
 }
 if(action==='commerce-open-ticket-room'){
  if(!canManagePtn()||!isPtnCode(id))return;
  c.ownedPtn={code:id};enter('ticket-manage');c.ownedPtn={code:id};c.ticketRoomOpen=true;
  return load('ticket-room-state');
 }
 if(action==='commerce-open-ticket-create'){
  if(ticketPilot()&&typeof activeTab!=='undefined'&&activeTab==='management'){enter('ticket-create');render();}
  return;
 }
 if(action==='commerce-close-ticket-create'){
  if(ticketCreationView(c)){enter('management');render();}
  return;
 }
 if(action==='commerce-retry'){if(c.pending)return mutate(c.pending.payload);return;}
 if(action==='commerce-order')return readOrder(id);
 if(action==='commerce-refresh-order')return readOrder(c.order.id);
 if(action==='commerce-back-orders'){c.order=null;c.error='';c.success='';render();return;}
 if(action==='commerce-category'){if(id!=='all'&&!storefrontKindVisible(id))return;c.category=id;c.order=null;c.productId='';render();return;}
 if(action==='commerce-categories'){c.category='';render();return;}
 if(action==='commerce-product'){if(!visibleProducts(c).some(p=>p.id===id))return;c.productId=id;render();return;}
 if(action==='commerce-back-products'){c.productId='';render();return;}
 if(action==='commerce-open-tickets'||action==='commerce-close-tickets'){
  if(c.view!=='shop'||!canSeeTickets())return;
  c.ticketsOpen=action==='commerce-open-tickets';c.tickets=null;c.ticketRoomOpen=false;c.ticketDraft=null;c.error='';render();return;
 }
 if(action==='commerce-ticket-bind'&&ticketPilot()&&ticketViewOpen(c)&&!c.pending){
  if(ptnCreation(c)?(!c.ptnStatus?.ok||c.ptnStatus.canCreate===false):
     ticketCreationView(c)&&c.tickets?.some(ticket=>ticket.boundRoomCode===pilotCode()))return;
  const ticket=c.tickets?.find(ticket=>ticket.id===id&&ticketAvailable(ticket));
  if(ticket){c.ticketDraft={ticket};c.ticketRoomOpen=true;c.error='';c.success='';render();}
  return;
 }
 if(action==='commerce-ticket-room'&&ticketPilot()&&ticketViewOpen(c)){
  if(!ticketRoomCode(c))return;
  c.ticketRoomOpen=true;c.ticketRoom=null;c.error='';c.success='';return load('ticket-room-state');
 }
 if(action==='commerce-ticket-back'&&ticketManagementView(c)){
  const manual=c.ownedPtn?.manual;
  enter('management');if(manual)c.ownedPtn=null;
  if(!inManagement()&&typeof activeTab!=='undefined')activeTab='management';
  render();return;
 }
 if(action==='commerce-ticket-open-manage'&&ticketManagementView(c)&&c.ticketRoom?.ok===true&&c.ticketRoom.code===ticketRoomCode(c)){
  c.roomManageOpen=true;window.BXHTicketManagementNavigate?.('registrations');render();return;
 }
 if(action==='commerce-ticket-close-manage'&&ticketManagementView(c)&&c.roomManageOpen){c.roomManageOpen=false;render();return;}
 if(action==='commerce-ticket-back'){c.ticketRoomOpen=false;c.ticketDraft=null;c.error='';c.success='';render();return;}
 if(action==='commerce-ticket-refresh'&&canOperateTicketRoom(c)&&c.ticketRoomOpen)return load('ticket-room-state');
 if(action==='commerce-ticket-select-delegate'&&ticketManagementView(c)&&c.ticketRoom?.canAssignDelegate&&c.delegateSearch?.code===c.ticketRoom.code&&!c.pending){
  const player=c.delegateSearch.players[Number(id)];
  if(!player||!Number.isInteger(Number(id)))return;
  if(!player.gameId){c.error='此帳號尚未設定遊戲 ID，請對方先完成設定再指定代理人。';render();return;}
  if(confirm(`確定指定 ${player.name}（遊戲 ID：${player.gameId}）管理 ${c.ticketRoom.code}？`))return mutate({action:'ticket-room-delegate',code:c.ticketRoom.code,delegateUid:player.uid});
  return;
 }
 if(action==='commerce-ticket-revoke-delegate'&&ticketManagementView(c)&&c.ticketRoom?.canAssignDelegate&&c.ticketRoom.delegateUid&&!c.pending){
  if(confirm('確定撤銷這名代理人的 PTN 房間管理權限？'))return mutate({action:'ticket-room-delegate',code:c.ticketRoom.code,delegateUid:null});
  return;
 }
 if(action==='commerce-ticket-remove'&&canOperateTicketRoom(c)&&c.ticketRoomOpen&&!c.pending){
  const room=c.ticketRoom;
  const player=room?.participants?.find(player=>player.registrationId===id);
  if(!player||room.code!==ticketRoomCode(c)||room.phase!=='waiting'||!confirm('確定移除「'+player.name+'」？'))return;
  return mutate({action:'ticket-room-remove',code:room.code,registrationId:id});
 }
 if(action==='commerce-ticket-forfeit'&&canOperateTicketRoom(c)&&c.ticketRoomOpen&&!c.pending){
  const room=c.ticketRoom,side=target?.dataset?.side;
  const match=room?.matches?.find(item=>item.id===id);
  if(!match||room.code!==ticketRoomCode(c)||room.phase!=='live'||!['a','b'].includes(side))return;
  const player=match[side],opponent=match[side==='a'?'b':'a'];
  if(!confirm('確定登記「'+player.name+'」本場棄權，由「'+opponent.name+'」晉級？'))return;
  return mutate({action:'ticket-room-forfeit',code:room.code,roomId:room.roomId,matchId:match.id,
   playerId:player.id,opponentId:opponent.id,matchUpdatedAt:match.updatedAt});
 }
 if(action==='commerce-ticket-score'&&ticketManagementView(c)&&c.ticketRoomOpen&&!c.pending){
  const room=c.ticketRoom,match=room?.bracket?.find(item=>item.id===id),command=target?.dataset?.command;
  if(!match?.canScore||room.code!==ticketRoomCode(c)||room.phase!=='live'||!['score','undo','confirm'].includes(command))return;
  const side=target?.dataset?.side,finish=target?.dataset?.finish;
  if(command==='score'&&(!['A','B'].includes(side)||!['spin','knockout','burst','extreme'].includes(finish)))return;
  if(command==='confirm'&&!confirm(`確認 ${match.a.name} ${match.scoreA}：${match.scoreB} ${match.b.name} 的賽果並讓勝者晉級？`))return;
  return mutate({action:'ticket-room-score',code:room.code,roomId:room.roomId,matchId:match.id,
   matchUpdatedAt:match.updatedAt,command,...(command==='score'?{side,finish}:{})});
 }
 if(['commerce-ticket-draw','commerce-ticket-start'].includes(action)&&canOperateTicketRoom(c)&&c.ticketRoomOpen&&!c.pending){
  const room=c.ticketRoom,start=action==='commerce-ticket-start';
  if(!room||room.code!==ticketRoomCode(c)||room.phase!=='waiting'||room.eligibleCount<2||start&&(!room.drawId||room.drawReady===false))return;
  const confirmEarlyStart=start&&Number(room.startAt)>Date.now();
  if(start&&!confirm(confirmEarlyStart?'尚未到預定時間。確定提前開賽並扣用啟動券？':'確定正式開賽並扣用啟動券？'))return;
  if(!start&&room.drawId&&!confirm('確定重新抽籤？'))return;
  const data={code:room.code,roomId:room.roomId,rosterRevision:room.rosterRevision};
  return mutate(start?{...data,action:'ticket-room-start',drawId:room.drawId,confirmEarlyStart}
   :{...data,action:'ticket-room-draw',baseDrawId:room.drawId});
 }
 if(action==='commerce-refresh-tickets'&&ticketViewOpen(c)){
  if(ptnCreation(c)&&!c.ptnStatus)return load('ticket-ptn-status');
  return load('my-tickets');
 }
 if(action==='commerce-refresh-products')return load('catalog');
 if(action==='commerce-products-more')return load(adminMode?'admin-products':'catalog',true);
 if(action==='commerce-refresh-orders')return load('my-orders');
 if(action==='commerce-orders-more')return load(adminMode?'admin-orders':'my-orders',true);
 if(action==='commerce-buy'){
  if(c.view!=='shop'||c.ticketsOpen||c.pending)return;
  const p=visibleProducts(c).find(p=>p.id===id);
  if(!purchasable(p))return;
  if(!document.querySelector('[data-commerce-consent]')?.checked){c.error='請先閱讀並勾選購買說明。';render();return;}
  return mutate({action:'create-order',productId:p.orderProductId||p.id,expectedVersion:p.version});
 }
 if(action==='commerce-cancel'&&confirm('確定取消這筆未付款訂單？'))return mutate({action:'cancel-order',orderId:c.order.id});
 if(!adminMode)return;
 if(action==='commerce-admin-zone'){c.adminZone=id;c.generation++;c.order=null;c.products=null;c.orders=null;c.configDraft=null;c.error='';c.success='';render();return;}
 if(action==='commerce-admin-refresh')return load(c.adminZone==='products'?'admin-products':c.adminZone==='config'?'admin-config':'admin-orders');
 if(action==='commerce-new-product'){c.draft={id:'product_'+crypto.randomUUID(),version:0,name:'',description:'',imageUrl:'',priceTwd:1,sort:0,status:'draft',audience:'all',terms:'',delivery:{kind:'skin',assetId:'',quantity:1,durationDays:0}};render();return;}
 if(action==='commerce-edit-product'){const p=c.products?.find(p=>p.id===id);if(p)c.draft={...p,delivery:{...p.delivery}};render();return;}
 if(action==='commerce-deliver'){c.busy=true;render();try{const r=await call({action:'admin-retry-delivery',orderId:c.order.id});if(c===context())c.order=r.order;}catch(e){if(c===context())c.error=errorMessage(e);}finally{if(c===context()){c.busy=false;render();}}}
}
document.addEventListener('submit',async e=>{
 const form=e.target.closest?.('[data-commerce-form]');if(!form)return;e.preventDefault();
 const c=context();if(c.busy||c.loading||c.pending)return;
 const values=Object.fromEntries(new FormData(form)),type=form.dataset.commerceForm;
 let payload;
 if(type==='ticket-open-code'){
  const code=String(values.code||'').trim().toUpperCase();
  if(!canManagePtn()||!inManagement()||!isPtnCode(code)){c.error='請輸入 PTN-XXXXXX 房號。';render();return;}
  enter('ticket-manage');c.ownedPtn={code,manual:true};c.ticketRoomOpen=true;
  await load('ticket-room-state');return;
 }
 if(type==='ticket-delegate-search'){
  const room=c.ticketRoom,query=String(values.query||'').trim();
  if(!ticketManagementView(c)||room?.canAssignDelegate!==true||room.code!==ticketRoomCode(c)||query.length<2||query.length>80)return;
  c.busy=true;c.error='';c.delegateSearch=null;render();
  try{const result=await call({action:'ticket-room-delegate-search',code:room.code,query});
   if(c===context()&&c.ticketRoom===room&&Array.isArray(result.players))c.delegateSearch={code:room.code,query,players:result.players};
  }catch(error){if(c===context())c.error=errorMessage(error);}
  finally{if(c===context()){c.busy=false;render();}}return;
 }else if(type==='ticket-schedule'){
  const room=c.ticketRoom;
  if(!ticketManagementView(c)||room?.phase!=='waiting'||room.code!==ticketRoomCode(c))return;
  const at=key=>Date.parse(values[key]+':00+08:00');
  payload={action:'ticket-room-schedule',code:room.code,expectedUpdatedAt:room.updatedAt,
   registrationOpenAt:at('registrationOpenAt'),registrationCloseAt:at('registrationCloseAt'),startAt:at('startAt')};
 }else if(type==='ticket-room'){
  if(!ticketPilot()||!ticketViewOpen(c)||!c.ticketDraft)return;
  const time=key=>Date.parse(values[key]+':00+08:00');
  payload={action:'create-ticket-room',...(ptnCreation(c)?{}:{code:pilotCode()}),ticketId:c.ticketDraft.ticket.id,name:values.name,
   location:values.location,stations:Number(values.stations),registrationOpenAt:time('registrationOpenAt'),
   registrationCloseAt:time('registrationCloseAt'),startAt:time('startAt')};
 }else if(type==='report')payload={action:'report-payment',orderId:c.order?.id,report:{lastFive:values.lastFive,transferredAt:Date.parse(values.transferredAt+':00+08:00'),note:values.note}};
 else{
  if(!isSuperAdmin())return;
  if(type==='confirm'){if(!confirm('已在銀行確認收到這筆款項？確認後系統將嘗試交付商品。'))return;payload={action:'admin-confirm-payment',orderId:c.order.id,receivedAmountTwd:Number(values.receivedAmountTwd),paymentReference:values.paymentReference,confirmed:true};}
  if(type==='request-info')payload={action:'admin-request-info',orderId:c.order.id,note:values.note};
  if(type==='refund-start'){if(!confirm('確定收回可退權益並開始全額退款？這一步不會自動匯款。'))return;payload={action:'admin-refund-start',orderId:c.order.id,note:values.note};}
  if(type==='refund-complete'){if(!confirm('已完成銀行退款，金額與交易識別碼正確？'))return;payload={action:'admin-refund-complete',orderId:c.order.id,refundedAmountTwd:Number(values.refundedAmountTwd),refundReference:values.refundReference};}
  if(type==='config')payload={action:'admin-config-save',expectedVersion:c.config?.version||0,enabled:values.enabled==='on',paymentHours:Number(values.paymentHours),bank:{bankCode:values.bankCode,bankName:values.bankName,branch:values.branch,accountName:values.accountName,accountNumber:values.accountNumber}};
  if(type==='product')payload={action:'admin-product-save',productId:c.draft.id,expectedVersion:c.draft.version||0,product:{name:values.name,description:values.description,imageUrl:values.imageUrl,priceTwd:Number(values.priceTwd),sort:Number(values.sort),status:values.status,audience:values.audience,terms:values.terms,delivery:{kind:values.kind,assetId:values.assetId,quantity:Number(values.quantity),durationDays:Number(values.durationDays)}}};
 }
 if(payload)await mutate(payload);
});
document.addEventListener('input',e=>{
 const form=e.target.closest?.('[data-commerce-form]');if(!form)return;const c=context(),v=Object.fromEntries(new FormData(form));
 if(form.dataset.commerceForm==='ticket-schedule'&&ticketManagementView(c))c.scheduleDraft=v;
 if(form.dataset.commerceForm==='ticket-room'&&c.ticketDraft)Object.assign(c.ticketDraft,v);
 if(form.dataset.commerceForm==='product'&&c.draft){Object.assign(c.draft,{name:v.name,description:v.description,imageUrl:v.imageUrl,priceTwd:v.priceTwd,sort:v.sort,status:v.status,audience:v.audience,terms:v.terms,delivery:{kind:v.kind,assetId:v.assetId,quantity:v.quantity,durationDays:v.durationDays}});}
 if(c.order){(c.formDrafts[c.order.id]||={})[form.dataset.commerceForm]=v;}
 if(form.dataset.commerceForm==='config')c.configDraft={...v,enabled:v.enabled==='on'};
});
document.addEventListener('change',e=>{if(!e.target.matches?.('[data-commerce-status]'))return;const c=context();if(c.loading||c.busy)return;c.status=e.target.value;c.orders=null;void load('admin-orders');});
window.BXHCommerce={shop,orders,adminPage,handle,context,load,loadPtnRoomCards,ticketPilot,ticketCreationPage,ownedTicketRoomCard,ticketManagementContext,ticketManagedTab,verifiedBracketRoom(){const c=context();return ticketManagementView(c)&&c.ticketRoom?.ok&&c.ticketRoom.code===ticketRoomCode(c)?c.ticketRoom:null;}};
})();
