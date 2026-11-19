/* Manual-bank commerce. Server owns price, eligibility, receipts and delivery. */
(function(){
'use strict';
let state=null;
const paymentLabels={pending:'待付款',reported:'待對帳',paid:'已確認收款',cancelled:'已取消',refund_pending:'退款處理中',refunded:'已退款'};
const deliveryLabels={not_started:'尚未交付',pending:'交付處理中',failed:'交付待處理',delivered:'已交付',revoked:'已收回',cancelled:'已取消交付'};
const kinds={room_quota:'開房次數',vip:'VIP 功能',skin:'Skin 外觀',item:'道具',ticket:'賽事啟動券'};
const storefrontKinds=new Set(['skin','item','ticket']);
const storefrontProduct=p=>storefrontKinds.has(p?.delivery?.kind);
const ticketPreviews=[32,64,96,128,160].map((capacity,index)=>({
 id:`tournament_activation_${capacity}`,name:`賽事啟動券｜${capacity} 人`,capacity,
 imageUrl:`assets/commerce/tickets/tournament-activation-${capacity}-${['green','blue','purple','orange','red'][index]}.png`,
 previewOnly:true,delivery:{kind:'ticket'}
}));
const ticketPreviewIds=new Set(ticketPreviews.map(p=>p.id));
function visibleProducts(c){
 const catalog=c.products||[];
 const ticketCards=ticketPreviews.map(preview=>{
  const offer=c.storeOpen===true&&catalog.find(p=>p?.delivery?.kind==='ticket'
   &&typeof p.id==='string'&&p.id&&p.status==='published'&&p.audience==='partner_organizer'
   &&p.delivery.assetId===String(preview.capacity)&&p.delivery.quantity===1&&p.delivery.durationDays===30
   &&Number.isSafeInteger(p.priceTwd)&&p.priceTwd>0&&Number.isSafeInteger(p.version)&&p.version>0);
  return offer?{...offer,id:preview.id,orderProductId:offer.id,previewOnly:false}:preview;
 });
 return [...ticketCards,...catalog.filter(p=>storefrontProduct(p)&&p.delivery.kind!=='ticket'&&!ticketPreviewIds.has(p.id))];
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
  state={session,products:null,productsCursor:null,tickets:null,ticketsOpen:false,ticketRoomOpen:false,ticketRoom:null,ticketDraft:null,orders:null,ordersCursor:null,config:null,capabilities:{},loading:false,busy:false,error:'',success:'',category:'',productId:'',order:null,adminZone:'orders',status:'reported',draft:null,configDraft:null,pending,formDrafts:{},generation:0,storeOpen:null};
 }
 return state;
}
function errorMessage(e){
 const m=String(e?.message||e||'');
 const labels={'service-unavailable':'商城服務準備中，請稍後再試。','store-closed':'商城尚未開放購買。','delivery-not-ready':'此類商品的交付功能尚未完成驗證，暫時不能上架或購買。','product-unavailable':'商品目前無法購買，請重新整理商城。','product-changed':'商品內容已更新，請重新整理後確認。','version-conflict':'資料已被更新，請重新整理後再編輯。','contract-required':'此商品限已簽約且授權有效的活動主辦購買。','contract-expired':'主辦合約尚未生效或已到期。','partner-organizer-required':'此商品限授權有效的合作主辦購買。','ticket-holding-limit':'已達同時持有 2 張的上限，待付款訂單也計入預留名額。','ticket-monthly-limit':'本月已達五款合計 4 張的限購上限。','ticket-quota-needs-review':'票券資料需要核對，請聯絡 BXH。','ticket-lifecycle-disabled':'目前沒有開放這間票券房的試點操作。','ticket-unavailable':'這張券目前無法用來建房，請重新整理票券。','ticket-expired':'啟動券已到期，或會在預定開賽前到期。','ticket-binding-invalid':'票券與房間資料不一致，請重新整理。','room-code-conflict':'試點房號已使用，請重新整理。','bracket-version-conflict':'抽籤資料已變更，請重新整理後再操作。','bracket-roster-changed':'可出賽名單已變更，請重新整理後再操作。','registration-roster-stale':'報名名單已更新，請重新整理後再操作。','registration-queue-pending':'報名資料正在更新，請稍後再試。','registration-queue-disabled':'這間賽事尚未開放 V2 操作。','early-start-confirmation-required':'尚未到預定開賽時間。','not-found':'目前找不到這間票券房。','unpaid-order-exists':'此商品已有未完成訂單，請到我的訂單查看。','already-owned':'你已持有此 Skin，無須重複購買。','bank-receipt-used':'這筆銀行交易已核銷，請確認是否重複使用。','amount-mismatch':'金額不符，請先釐清差額再確認。','payment-window-closed':'已超過付款期限或訂單狀態已變更，請聯絡 BXH。','invalid-remittance':'請填寫匯款末五碼與正確的轉帳時間。','refund-needs-review':'商品已有使用或後續異動，需要人工評估，暫不能自動收回。','transition-forbidden':'訂單狀態已變更，請重新讀取確認。','operation-conflict':'操作識別碼與原請求不一致，請保留訂單編號聯絡 BXH。','storage-unavailable':'瀏覽器無法保存待確認操作，請允許工作階段儲存後再試。','super-admin-required':'只有最高管理員可以執行此操作。','account-inactive':'帳號目前不可購買。','invalid-bank':'請確認三碼銀行代碼及收款帳號。','invalid-number':'請檢查金額、數量或期限。','invalid-text':'請完整填寫欄位。','invalid-image':'商品圖片請使用 HTTPS 網址。','invalid-vip-duration':'VIP 須設定有效天數，數量為 1。','invalid-quota-duration':'場次額度的期限沿用合約，商品天數請填 0。','cancel-unavailable':'這筆訂單已無法自行取消。','order-unavailable':'找不到可查看的訂單。','invalid-action':'無法執行這項操作。'};
 for(const [k,v]of Object.entries(labels))if(m.includes(k))return v;
 return '連線尚未確認，請重試；系統會沿用原操作避免重複下單。';
}
const permanentErrors=/registration-(queue-pending|queue-disabled|roster-stale)|early-start-confirmation-required|bracket-started|ticket-lifecycle-disabled|ticket-unavailable|ticket-expired|ticket-binding-invalid|room-code-conflict|bracket-version-conflict|bracket-roster-changed|permission-denied|not-found|partner-organizer-required|ticket-holding-limit|ticket-monthly-limit|product-unavailable|store-closed|delivery-not-ready|product-changed|version-conflict|contract-required|contract-expired|unpaid-order-exists|already-owned|bank-receipt-used|amount-mismatch|payment-window-closed|invalid-|refund-needs-review|transition-forbidden|cancel-unavailable|account-inactive|super-admin-required|order-unavailable/;
const money=n=>'NT$ '+Number(n||0).toLocaleString('zh-TW');
const date=n=>n?new Date(n).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
function image(url){if(/^assets\/commerce\/tickets\/tournament-activation-(32-green|64-blue|96-purple|128-orange|160-red)\.png$/.test(url))return url;try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function notices(c){return `${c.error?`<p class="commerce-error" role="alert">${esc(c.error)}</p>`:''}${c.success?`<p class="commerce-success" role="status">${esc(c.success)}</p>`:''}${c.pending?`<div class="banner"><span>有一筆操作尚待確認。</span><button class="btn btn-primary" data-action="commerce-retry" ${c.busy?'disabled':''}>確認原操作結果</button></div>`:''}`;}
const pilotCode=()=>window.BXH_TICKET_ROOM_PILOT_CODE;
const ticketActions=new Set(['create-ticket-room','ticket-room-state','ticket-room-draw','ticket-room-start','ticket-room-remove']);
const ticketPilot=()=>typeof pilotCode()==='string'&&/^BXH-[A-Z0-9]{4,16}$/.test(pilotCode());
async function call(payload){
 const service=window.engagementService;
 const handler=ticketActions.has(payload.action)?service?.ticketRoomOperation:service?.commerce;
 if(typeof handler!=='function')throw Error('service-unavailable');
 const r=await handler.call(service,payload);
 if(!r?.ok)throw Error(r?.error||'request-failed');
 return r;
}
async function load(kind,more=false){
 const c=context();if(c.loading||c.busy||!currentAuthUid())return;
 if(kind.startsWith('admin-')&&!isSuperAdmin())return;
 const generation=++c.generation;c.loading=true;c.error='';render();
 try{
  const cursor=more?(kind.includes('products')||kind==='catalog'?c.productsCursor:c.ordersCursor):null;
  const r=await call(kind==='ticket-room-state'?{action:kind,code:pilotCode()}:{action:kind,cursor,...(kind==='admin-orders'?{status:c.status}:{})});if(c!==context()||generation!==c.generation)return;
  if(kind==='ticket-room-state')c.ticketRoom=r;
  if(typeof r.storeOpen==='boolean')c.storeOpen=r.storeOpen;
  if(r.products){c.products=more?[...(c.products||[]),...r.products]:r.products;c.productsCursor=r.nextCursor;}
  if(kind==='my-tickets'&&Array.isArray(r.tickets))c.tickets=r.tickets;
  if(r.orders){c.orders=more?[...(c.orders||[]),...r.orders]:r.orders;c.ordersCursor=r.nextCursor;}
  if(kind==='admin-config'){c.config=r.config;c.capabilities=r.capabilities;c.configDraft={enabled:r.config?.enabled===true,paymentHours:r.config?.paymentHours||48,bankCode:r.config?.bank?.bankCode||'',bankName:r.config?.bank?.bankName||'',branch:r.config?.bank?.branch||'',accountName:r.config?.bank?.accountName||'',accountNumber:r.config?.bank?.accountNumber||''};}
 }catch(e){if(c===context()&&generation===c.generation)c.error=errorMessage(e);}finally{if(c===context()&&generation===c.generation){c.loading=false;render();}}
}
async function mutate(payload){
 const c=context();if(c.busy||c.loading)return;
 const view=c.view;c.busy=true;c.error='';c.success='';render();
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
   c.tickets=null;c.ticketDraft=null;c.ticketRoom=null;
   if(view===c.view&&view==='shop'){c.ticketsOpen=true;c.ticketRoomOpen=true;}
  }
  c.success=({ 'create-ticket-room':'已建房並綁定啟動券。','ticket-room-draw':'抽籤完成。','ticket-room-start':'正式開賽，啟動券已扣用。','ticket-room-remove':'已移除選手。請重新抽籤。'})[action]||'操作已確認完成。';
 }catch(e){if(c===context()){
  c.error=errorMessage(e);
  if(permanentErrors.test(String(e?.message||e))){c.pending=null;try{sessionStorage.removeItem(storageKey());}catch{}}
 }}finally{if(c===context()){c.busy=false;render();}}
}
function schedule(kind,empty){const c=context();if(empty&&!c.loading&&!c.busy&&!c.error)setTimeout(()=>load(kind),0);}
function productDetails(p,c){
 if(p.previewOnly)return `<section class="panel commerce-detail"><button class="btn btn-ghost" data-action="commerce-back-products">返回商品清單</button><img class="commerce-hero" src="${esc(image(p.imageUrl))}" alt="${esc(p.name)}"><h2>${esc(p.name)}</h2><p class="commerce-ticket-status" role="status">暫停購買</p><p class="commerce-price">價格待公告</p><p class="commerce-copy">單場積分賽適用，基本正取上限 ${p.capacity} 人。備取人數不計入基本上限；開房時選券並綁定房間，開賽後使用一張券。</p><dl class="commerce-facts"><dt>購買資格</dt><dd>授權有效的合作主辦</dd><dt>有效期限</dt><dd>待公告</dd></dl><p class="hint">目前僅供瀏覽，尚未開放付款、建立訂單或發券。價格與期限確認後另行公告。</p><button class="btn btn-primary" disabled aria-disabled="true">暫停購買</button></section>`;
 return `<section class="panel commerce-detail"><button class="btn btn-ghost" data-action="commerce-back-products">返回商品清單</button>${image(p.imageUrl)?`<img class="commerce-hero" src="${esc(image(p.imageUrl))}" alt="${esc(p.name)}">`:''}<h2>${esc(p.name)}</h2><p class="commerce-price">${money(p.priceTwd)}</p><p class="commerce-copy">${esc(p.description)}</p><dl class="commerce-facts"><dt>商品類型</dt><dd>${esc(kinds[p.delivery.kind])}</dd><dt>購買資格</dt><dd>${audienceLabel(p.audience)}</dd><dt>內容數量</dt><dd>${Number(p.delivery.quantity)}</dd><dt>持有／使用期限</dt><dd>${p.delivery.kind==='room_quota'?'依主辦合約與商品條款':p.delivery.durationDays?Number(p.delivery.durationDays)+' 天':'永久持有'}</dd>${p.delivery.kind==='ticket'?'<dt>購買上限</dt><dd>同時最多持有 2 張，每月五款合計限購 4 張。</dd>':''}</dl><h3>購買說明</h3><p class="commerce-copy">${esc(p.terms)}</p><p class="hint">銀行轉帳後，請至我的訂單回報匯款資訊。BXH 確認收款後交付；有期限的權益從成功開通起計算。</p>${!purchasable(p)?`<p role="status">${esc(errorMessage(p.unavailableReason))}</p>`:''}<label class="commerce-consent"><input type="checkbox" data-commerce-consent> 我已閱讀商品內容、資格、期限與購買說明</label><button class="btn btn-primary" data-action="commerce-buy" data-id="${esc(p.id)}" ${c.busy||c.loading||c.pending||!purchasable(p)?'disabled':''}>建立訂單｜${money(p.priceTwd)}</button></section>`;
}
function enter(view){const c=context();if(c.view!==view){c.view=view;c.generation++;c.loading=false;c.storeOpen=null;c.products=null;c.tickets=null;c.ticketsOpen=false;c.ticketRoomOpen=false;c.ticketRoom=null;c.ticketDraft=null;c.orders=null;c.order=null;c.error='';c.success='';}return c;}
function ticketWallet(c){
 const locked=c.loading||c.busy||!!c.pending;
 const controls=ticket=>!ticketPilot()?'':ticket.status==='available'
  ?`<button class="btn btn-primary" data-action="commerce-ticket-bind" data-id="${esc(ticket.id)}" ${locked?'disabled':''}>選這張券建房</button>`
  :ticket.boundRoomCode===pilotCode()?`<button class="btn btn-ghost" data-action="commerce-ticket-room" ${locked?'disabled':''}>管理賽事</button>`:'';
 return `<section class="commerce"><div class="panel-title"><h2>我的啟動券</h2><button class="btn btn-ghost" data-action="commerce-close-tickets">返回商城</button></div>${notices(c)}${c.loading?'<p role="status">正在讀取啟動券……</p>':c.tickets===null?'':c.tickets.length?`<div class="commerce-orders">${c.tickets.map(ticket=>`<article class="panel commerce-order"><span><strong>賽事啟動券｜${Number(ticket.capacity)} 人</strong><small>${ticket.status==='reserved'?'已綁定房間 '+esc(ticket.boundRoomCode):'可使用'}</small>${controls(ticket)}</span><span><small>到期時間（台灣時間）<br>${date(ticket.expiresAt)}</small></span></article>`).join('')}</div>`:'<div class="empty-state">目前沒有有效的啟動券。</div>'}<button class="btn btn-ghost" data-action="commerce-refresh-tickets" ${c.loading?'disabled':''}>重新整理</button></section>`;
}
function ticketRoomPanel(c){
 const back='<button class="btn btn-ghost" data-action="commerce-ticket-back">返回我的啟動券</button>';
 const pending=c.loading||c.busy||!!c.pending;
 if(c.ticketDraft){
  const {ticket,...v}=c.ticketDraft;
  const time=(key,label)=>input(key,label,v[key],'datetime-local','data-minute-precision="true" required');
  return `<section class="panel commerce">${back}<h2>選券建房</h2>${notices(c)}<p>房號 ${esc(pilotCode())}｜正取上限 ${Number(ticket.capacity)} 人</p><form data-commerce-form="ticket-room">${input('name','賽事名稱',v.name,'text','maxlength="80" required')}${input('location','場地',v.location,'text','maxlength="160"')}${input('stations','裁判台數',v.stations||1,'number','min="1" max="12" step="1" required')}${time('registrationOpenAt','報名開放（台灣時間）')}${time('registrationCloseAt','報名截止（台灣時間）')}${time('startAt','預定開賽（台灣時間）')}<button class="btn btn-primary" ${pending?'disabled':''}>建立房間並綁券</button></form></section>`;
 }
 const room=c.ticketRoom;
 return `<section class="panel commerce">${back}<h2>${room?esc(room.name):'票券賽事'}</h2>${notices(c)}${c.loading?'<p role="status">正在讀取賽事……</p>':''}${room?`<p>${esc(room.code)}｜${room.phase==='waiting'?'等待開賽':room.phase==='live'?'已開賽':'賽事已離開候賽階段'}</p><p>可出賽 ${Number(room.eligibleCount)} 人｜${room.drawId?(room.drawReady===false?'名單已變更，請重新抽籤':'已抽籤'):'尚未抽籤'}</p>${room.phase==='waiting'?`<div class="btn-row"><button class="btn btn-ghost" data-action="commerce-ticket-draw" ${pending||room.eligibleCount<2?'disabled':''}>${room.drawId?'重新抽籤':'抽籤'}</button><button class="btn btn-primary" data-action="commerce-ticket-start" ${pending||!room.drawId||room.drawReady===false||room.eligibleCount<2?'disabled':''}>正式開賽並扣券</button></div>${room.participants?.length?`<details><summary>管理參賽名單（${room.participants.length} 人）</summary><ul>${room.participants.map(player=>`<li>${esc(player.name)} <button type="button" class="btn btn-ghost" data-action="commerce-ticket-remove" data-id="${esc(player.registrationId)}" ${pending?'disabled':''}>移除</button></li>`).join('')}</ul></details>`:''}`:''}`:''}<button class="btn btn-ghost" data-action="commerce-ticket-refresh" ${c.loading?'disabled':''}>重新整理賽事</button></section>`;
}

function shop(){
 const c=enter('shop');
 if(c.ticketsOpen){
  if(ticketPilot()&&c.ticketRoomOpen){schedule('ticket-room-state',!c.ticketDraft&&c.ticketRoom===null);return ticketRoomPanel(c);}
  schedule('my-tickets',c.tickets===null);return ticketWallet(c);
 }
 schedule('catalog',c.products===null);
 if(c.order)return orderDetail(c.order,c,false);
 if(c.category&&c.category!=='all'&&!storefrontKinds.has(c.category))c.category='';
 const p=visibleProducts(c).find(p=>p.id===c.productId);
 let body;
 if(p)body=productDetails(p,c);
 else if(!c.category)body=`<div class="commerce-grid">${[['all','全部商品'],...Object.entries(kinds).filter(([id])=>storefrontKinds.has(id))].map(([id,name])=>`<button class="panel commerce-category" data-action="commerce-category" data-id="${id}"><strong>${name}</strong><span>查看商品 →</span></button>`).join('')}</div>`;
 else body=`<button class="btn btn-ghost" data-action="commerce-categories">返回商品分類</button>${c.category==='ticket'?'<button class="btn btn-ghost" data-action="commerce-open-tickets">我的啟動券</button>':''}<h3>${esc(kinds[c.category]||'全部商品')}</h3><div class="commerce-grid">${visibleProducts(c).filter(p=>c.category==='all'||p.delivery.kind===c.category).map(p=>`<article class="panel commerce-card${p.delivery.kind==='ticket'?' commerce-ticket-card':''}">${image(p.imageUrl)?`<img src="${esc(image(p.imageUrl))}" alt="${esc(p.name)}" loading="lazy">`:''}<span class="hint">${esc(kinds[p.delivery.kind])}</span><h3>${esc(p.name)}</h3><strong class="commerce-price">${p.previewOnly?'價格待公告':money(p.priceTwd)}</strong>${p.previewOnly?'<p class="commerce-ticket-status">暫停購買</p>':p.delivery.kind==='ticket'?'<p class="hint">合作主辦限定</p>':''}<button class="btn btn-ghost" data-action="commerce-product" data-id="${esc(p.id)}">查看商品</button></article>`).join('')||'<div class="empty-state">此分類目前沒有上架商品。</div>'}</div>${c.productsCursor?'<button class="btn btn-ghost" data-action="commerce-products-more">載入更多商品</button>':''}`;
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
 return `<form data-commerce-form="product"><h3>${p.version?'編輯商品':'新增商品草稿'}</h3><p class="hint">商品代碼：${esc(p.id)}｜版本 ${p.version||0}</p>${input('name','商品名稱',p.name,'text','maxlength="80" required')}${input('imageUrl','照片網址（HTTPS）',p.imageUrl,'url','required')}<label>商品說明<textarea name="description" maxlength="4000" required>${esc(p.description)}</textarea></label><div class="commerce-grid">${input('priceTwd','價格（新臺幣）',p.priceTwd,'number','min="1" step="1" required')}<label>交付類型<select name="kind">${Object.entries(kinds).map(([id,l])=>`<option value="${id}" ${p.delivery.kind===id?'selected':''}>${l}</option>`).join('')}</select></label>${input('assetId','權益／道具代碼（啟動券填人數）',p.delivery.assetId,'text','pattern="[A-Za-z0-9_-]{1,128}" required')}${input('quantity','數量',p.delivery.quantity,'number','min="1" max="10000" step="1" required')}${input('durationDays','有效天數（永久填 0；VIP 必填正數）',p.delivery.durationDays,'number','min="0" max="3650" step="1" required')}${input('sort','排序',p.sort,'number','min="0" max="10000" step="1" required')}</div><label>購買資格<select name="audience"><option value="all" ${p.audience==='all'?'selected':''}>一般會員</option><option value="signed_organizer" ${p.audience==='signed_organizer'?'selected':''}>有效簽約活動主辦</option><option value="partner_organizer" ${p.audience==='partner_organizer'?'selected':''}>有效合作主辦</option></select></label><label>購買說明與退款處理方式<textarea name="terms" maxlength="2000" required>${esc(p.terms)}</textarea></label><label>狀態<select name="status">${[['draft','草稿'],['published','上架'],['disabled','下架']].map(([id,l])=>`<option value="${id}" ${p.status===id?'selected':''}>${l}</option>`).join('')}</select></label><p class="hint">交付類型必須通過後端功能串接驗證才能上架。場次商品僅限有效簽約主辦。啟動券請設定合作主辦限定、數量 1、有效 30 天。</p><button class="btn btn-primary" ${c.busy||c.pending?'disabled':''}>儲存商品</button><button type="button" class="btn btn-ghost" data-action="commerce-new-product">新增另一項</button></form>`;}
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
 if(action==='commerce-retry'){if(c.pending)return mutate(c.pending.payload);return;}
 if(action==='commerce-order')return readOrder(id);
 if(action==='commerce-refresh-order')return readOrder(c.order.id);
 if(action==='commerce-back-orders'){c.order=null;c.error='';c.success='';render();return;}
 if(action==='commerce-category'){if(id!=='all'&&!storefrontKinds.has(id))return;c.category=id;c.order=null;c.productId='';render();return;}
 if(action==='commerce-categories'){c.category='';render();return;}
 if(action==='commerce-product'){if(!visibleProducts(c).some(p=>p.id===id))return;c.productId=id;render();return;}
 if(action==='commerce-back-products'){c.productId='';render();return;}
 if(action==='commerce-open-tickets'||action==='commerce-close-tickets'){
  c.ticketsOpen=action==='commerce-open-tickets';c.tickets=null;c.ticketRoomOpen=false;c.ticketDraft=null;c.error='';render();return;
 }
 if(action==='commerce-ticket-bind'&&ticketPilot()&&c.view==='shop'&&c.ticketsOpen&&!c.pending){
  const ticket=c.tickets?.find(ticket=>ticket.id===id&&ticket.status==='available');
  if(ticket){c.ticketDraft={ticket};c.ticketRoomOpen=true;c.error='';c.success='';render();}
  return;
 }
 if(action==='commerce-ticket-room'&&ticketPilot()&&c.view==='shop'&&c.ticketsOpen){
  c.ticketRoomOpen=true;c.ticketRoom=null;c.error='';c.success='';return load('ticket-room-state');
 }
 if(action==='commerce-ticket-back'){c.ticketRoomOpen=false;c.ticketDraft=null;c.error='';c.success='';render();return;}
 if(action==='commerce-ticket-refresh'&&ticketPilot()&&c.ticketRoomOpen)return load('ticket-room-state');
 if(action==='commerce-ticket-remove'&&ticketPilot()&&c.ticketRoomOpen&&!c.pending){
  const room=c.ticketRoom;
  const player=room?.participants?.find(player=>player.registrationId===id);
  if(!player||room.code!==pilotCode()||room.phase!=='waiting'||!confirm('確定移除「'+player.name+'」？'))return;
  return mutate({action:'ticket-room-remove',code:room.code,registrationId:id});
 }
 if(['commerce-ticket-draw','commerce-ticket-start'].includes(action)&&ticketPilot()&&c.ticketRoomOpen&&!c.pending){
  const room=c.ticketRoom,start=action==='commerce-ticket-start';
  if(!room||room.code!==pilotCode()||room.phase!=='waiting'||room.eligibleCount<2||start&&(!room.drawId||room.drawReady===false))return;
  const confirmEarlyStart=start&&Number(room.startAt)>Date.now();
  if(start&&!confirm(confirmEarlyStart?'尚未到預定時間。確定提前開賽並扣用啟動券？':'確定正式開賽並扣用啟動券？'))return;
  if(!start&&room.drawId&&!confirm('確定重新抽籤？'))return;
  const data={code:room.code,roomId:room.roomId,rosterRevision:room.rosterRevision};
  return mutate(start?{...data,action:'ticket-room-start',drawId:room.drawId,confirmEarlyStart}
   :{...data,action:'ticket-room-draw',baseDrawId:room.drawId});
 }
 if(action==='commerce-refresh-tickets'&&c.view==='shop'&&c.ticketsOpen)return load('my-tickets');
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
 if(type==='ticket-room'){
  if(!ticketPilot()||c.view!=='shop'||!c.ticketDraft)return;
  const time=key=>Date.parse(values[key]+':00+08:00');
  payload={action:'create-ticket-room',code:pilotCode(),ticketId:c.ticketDraft.ticket.id,name:values.name,
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
 if(form.dataset.commerceForm==='ticket-room'&&c.ticketDraft)Object.assign(c.ticketDraft,v);
 if(form.dataset.commerceForm==='product'&&c.draft){Object.assign(c.draft,{name:v.name,description:v.description,imageUrl:v.imageUrl,priceTwd:v.priceTwd,sort:v.sort,status:v.status,audience:v.audience,terms:v.terms,delivery:{kind:v.kind,assetId:v.assetId,quantity:v.quantity,durationDays:v.durationDays}});}
 if(c.order){(c.formDrafts[c.order.id]||={})[form.dataset.commerceForm]=v;}
 if(form.dataset.commerceForm==='config')c.configDraft={...v,enabled:v.enabled==='on'};
});
document.addEventListener('change',e=>{if(!e.target.matches?.('[data-commerce-status]'))return;const c=context();if(c.loading||c.busy)return;c.status=e.target.value;c.orders=null;void load('admin-orders');});
window.BXHCommerce={shop,orders,adminPage,handle,context,load};
})();
