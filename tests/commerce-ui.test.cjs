'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../commerce-ui.js'),'utf8');
function setup({partner=false}={}){
 const storage=new Map(),calls=[],listeners={};let uid='buyer',epoch=1,admin=false,fail=false;
 const sandbox={window:{engagementService:{commerce:async p=>{calls.push(JSON.parse(JSON.stringify(p)));if(fail)throw Error('network-timeout');return {ok:true,order:{id:'ORDER_TEST'}};}}},currentAuthUid:()=>uid,get engagementSessionEpoch(){return epoch;},isSuperAdmin:()=>admin,isPartnerOrganizerMode:()=>partner,render(){},setTimeout(){},URL,Date,crypto:{randomUUID:()=> 'same-operation'},confirm:()=>true,esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{addEventListener:(k,f)=>listeners[k]=f,querySelector:()=>({checked:true})}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
 const extract=(start,end)=>core.slice(core.indexOf(start),core.indexOf(end,core.indexOf(start)));
 Object.assign(sandbox,{matchStatusClass:()=>'',activeMatchCourtAtmosphereStyle:()=>'',quickModeTagHtml:()=>'',matchScoreCellHtml:(m,side)=>String(m['score'+side]),matchStatusBarHtml:()=>'',wrapBracketWatermark:s=>s,trophySvg:()=>'',state:new Proxy({},{get(){throw Error('PTN must not read official state')}})});
 sandbox.window.BXHFormatUtils={matchSequenceLabel:n=>String(n)};
 Object.assign(sandbox,{bracketViewMode:'board',boardTheme:'gold',boardZoom:1,boardPanX:0,boardPanY:0,boardStageSelection:{key:'',size:0},BOARD_STAGE_SIZES:[128,64,32,16],BOARD_THEMES:{gold:{label:'帝王金'}},FORMAT_LABELS:{single:'單淘汰賽'},LOGO_SRC:'',SHARE_ICON_SVG:'',BOARD_ICON_EXPORT:'',BOARD_ICON_MINUS:'',BOARD_ICON_PLUS:'',BOARD_ICON_FULLSCREEN:'',matchLegendHtml:()=>''});
 vm.runInContext(extract('function renderBracketModeControls(', 'let singleBracketPathSelection')+extract('function activeTicketBoardView(', '// View-only identity')+extract('function availableBoardStage(', 'function singleRoundTitle(')+extract('function seMatchBoxHtml(', 'const BOARD_MEDAL_SVG')+extract('function renderSingleElimBracket(', '/* ==== single-elim tree'),sandbox);
 sandbox.hasAdminAccess=()=>partner||admin;
 vm.runInContext(extract('window.BXHTicketManagementNavigate=','function renderApp('),sandbox);
 return {ui:sandbox.window.BXHCommerce,calls,storage,listeners,sandbox,setUid:v=>{uid=v;epoch++;},setAdmin:v=>admin=v,setPartner:v=>partner=v,setFail:v=>fail=v};
}
test('pending order retries reuse original operation/payload even after a connection failure',async()=>{
 const t=setup();t.ui.shop();const c=t.ui.context();c.products=[{id:'skin',version:1,purchasable:true,delivery:{kind:'skin'}}];
 t.setFail(true);await t.ui.handle('commerce-buy',{dataset:{id:'skin'}});assert.ok(c.pending);assert.equal(t.calls.length,1);
 t.setFail(false);await t.ui.handle('commerce-retry',{});assert.deepEqual(t.calls[0],t.calls[1]);assert.equal(c.pending,null);
});
test('account/session changes isolate products, orders, drafts and pending operations',async()=>{
 const t=setup();t.ui.shop();const c=t.ui.context();c.products=[{id:'skin',version:1,purchasable:true,delivery:{kind:'skin'}}];c.order={id:'PRIVATE_ORDER'};
 t.setFail(true);await t.ui.handle('commerce-buy',{dataset:{id:'skin'}});t.setUid('other');
 const next=t.ui.context();assert.notEqual(c,next);assert.equal(next.order,null);assert.equal(next.products,null);assert.equal(next.pending,null);
});
test('admin product cache is discarded on entry to player shop and all content is escaped',()=>{
 const t=setup();t.setAdmin(true);t.ui.adminPage();const c=t.ui.context();c.products=[{id:'draft_private',name:'draft'}];t.ui.shop();assert.equal(c.products,null);
 c.products=[{id:'safe',name:'<script>unsafe</script>',priceTwd:100,imageUrl:'javascript:alert(1)',delivery:{kind:'skin'},description:'test',audience:'all'}];c.category='all';
 const html=t.ui.shop();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>unsafe'));assert.ok(!html.includes('src="javascript:'));
});
test('management UI and backend wrapper are wired without granting staff commerce access',()=>{
 const root=path.join(__dirname,'..'),core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
 assert.match(core,/if\(isSuperAdmin\(\)\)tabs\.splice\([^\n]+commerce-admin/);
 assert.match(core,/targetTab==='commerce-admin'&&!isSuperAdmin/);
 assert.match(core,/data-tab="orders">我的訂單/);
 const s={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'modules/management-v2/navigation.js'),'utf8'),s);
 assert.ok(s.window.BXH_MANAGEMENT_UI_V2.renderRails('commerce-admin',['commerce-admin']).includes('商城管理'));
 assert.ok(!s.window.BXH_MANAGEMENT_UI_V2.renderRails('live',['live','duty']).includes('commerce-admin'));
 assert.match(fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8'),/commerce\(payload\).*commerceService/);
});
test('partner organizer can open the storefront and orders in both management interfaces',()=>{
 const root=path.join(__dirname,'..'),core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
 assert.match(core,/if\(isPartnerOrganizerMode\(\)\)tabs\.splice\([^\n]+commerce-shop[^\n]+commerce-orders/);
 assert.match(core,/activeTab==="commerce-shop"\) content = window\.BXHCommerce\.shop\(\)/);
 assert.match(core,/activeTab==="commerce-orders"\) content = window\.BXHCommerce\.orders\(\)/);
 assert.match(core,/targetTab==='commerce-shop'\|\|targetTab==='commerce-orders'\)\&\&!isPartnerOrganizerMode\(\)/);
 assert.match(core,/data-action="switch-tab" data-tab="commerce-shop">商城/);
 assert.match(core,/const doSwitch = \(\)=>\{\s*accountMenuOpen=false;/);
 const s={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'modules/management-v2/navigation.js'),'utf8'),s);
 const nav=s.window.BXH_MANAGEMENT_UI_V2;
 assert.match(nav.renderRails('commerce-shop',['management','commerce-shop','commerce-orders']),/data-management-v2-tab="commerce-shop"/);
 assert.match(nav.renderRails('commerce-orders',['management','commerce-shop','commerce-orders']),/data-management-v2-tab="commerce-orders"/);
 assert.ok(!nav.renderRails('management',['management','live']).includes('data-management-v2-group="commerce"'));
});
test('partner ticket room entry is available without an old pilot URL flag',()=>{
 const index=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(index,/window\.BXH_PTN_TICKET_SALE = true;/);
 assert.doesNotMatch(index,/get\("ptnSale"\)/);
 const t=setup({partner:true});
 t.sandbox.window.BXH_PTN_TICKET_SALE=true;
 assert.equal(t.ui.ticketPilot(),true);
 t.setPartner(false);
 assert.equal(t.ui.ticketPilot(),false);
});
test('launched PTN sale can create an unassigned room without opening legacy routes',()=>{
 const root=path.join(__dirname,'..');
 const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');
 const start=cloud.indexOf('async ticketRoomOperation({action,code,...payload}){');
 const end=cloud.indexOf("if(action==='ticket-room-remove')",start);
 assert.ok(start>=0&&end>start);
 const gate=cloud.slice(start+'async ticketRoomOperation({action,code,...payload}){'.length,end);
 const allowed=new Function('action','code','window','ticketRegistrationPilot',gate+'return true;');
 const sale={BXH_PTN_TICKET_SALE:true,BXH_TICKET_ROOM_PTN_PILOT:false};
 const legacy={BXH_PTN_TICKET_SALE:false,BXH_TICKET_ROOM_PTN_PILOT:true};
 const known=code=>/^PTN-[A-Z0-9]{6}$/.test(code||'');
 assert.equal(allowed('create-ticket-room',undefined,sale,known),true);
 assert.equal(allowed('ticket-ptn-status',undefined,sale,known),true);
 assert.throws(()=>allowed('ticket-room-state',undefined,sale,known),/ticket-lifecycle-disabled/);
 assert.throws(()=>allowed('create-ticket-room',undefined,{BXH_PTN_TICKET_SALE:false,BXH_TICKET_ROOM_PTN_PILOT:false},known),/ticket-lifecycle-disabled/);
 assert.equal(allowed('create-ticket-room',undefined,legacy,known),true);
 assert.throws(()=>allowed('create-ticket-room','BXH-UNLISTED',sale,known),/ticket-lifecycle-disabled/);
 assert.equal(allowed('ticket-room-state','PTN-ABCDEF',sale,known),true);
});
test('an old admin catalog response cannot populate the player shop after navigation',async()=>{
 const t=setup();t.setAdmin(true);t.ui.adminPage();
 let resolve;t.sandbox.window.engagementService.commerce=()=>new Promise(r=>resolve=r);
 const pending=t.ui.load('admin-products');t.ui.shop();
 resolve({ok:true,products:[{id:'private_draft'}],nextCursor:null});await pending;
 assert.equal(t.ui.context().products,null);assert.equal(t.ui.context().loading,false);
});
test('a closed store is clearly labeled and does not create placeholder products',async()=>{
 const t=setup();t.ui.shop();t.sandbox.window.engagementService.commerce=async()=>({ok:true,products:[],nextCursor:null,storeOpen:false});
 await t.ui.load('catalog');assert.match(t.ui.shop(),/商城準備中，目前尚未開放購買/);assert.equal(t.ui.context().products.length,0);
});

test('five ticket previews remain visible with a closed store and cannot create orders',async()=>{
 const t=setup({partner:true});t.ui.shop();const c=t.ui.context();c.products=[];c.storeOpen=false;
 const categories=t.ui.shop();assert.match(categories,/data-id="ticket"/);
 await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 const listing=t.ui.shop();
 for(const [capacity,color] of [[32,'green'],[64,'blue'],[96,'purple'],[128,'orange'],[160,'red']]){
  assert.match(listing,new RegExp(`賽事啟動券｜${capacity} 人`));
  assert.match(listing,new RegExp(`tournament-activation-${capacity}-${color}\\.png`));
  assert.ok(fs.existsSync(path.join(__dirname,`../assets/commerce/tickets/tournament-activation-${capacity}-${color}.png`)));
 }
 assert.equal((listing.match(/尚未開放購買/g)||[]).length,6);
 await t.ui.handle('commerce-product',{dataset:{id:'tournament_activation_64'}});
 const detail=t.ui.shop();assert.match(detail,/基本正取上限 64 人/);
 assert.match(detail,/<button class="btn btn-primary" disabled aria-disabled="true">尚未開放購買<\/button>/);
 await t.ui.handle('commerce-buy',{dataset:{id:'tournament_activation_64'}});
 c.products=[{id:'tournament_activation_64',version:1,purchasable:true,delivery:{kind:'ticket'}}];
 await t.ui.handle('commerce-buy',{dataset:{id:'tournament_activation_64'}});
 assert.equal(t.calls.length,0);
});

 test('bank remittance fields opt out of the real application half-hour rounding',()=>{
 const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
 assert.match(source,/name="transferredAt"[^>]*data-minute-precision="true"/);
 assert.ok(core.includes('if(el.dataset.minutePrecision==="true") return;'));
 });

test('storefront hides room quota and VIP categories, all-products results and cached detail/actions',async()=>{
 const t=setup();t.ui.shop();const c=t.ui.context();
 c.products=['room_quota','vip','skin','item'].map(kind=>({id:kind,name:'product_'+kind,priceTwd:100,version:1,purchasable:true,audience:'all',delivery:{kind,quantity:1,durationDays:0}}));
 const categories=t.ui.shop();assert.ok(!categories.includes('data-id="room_quota"'));assert.ok(!categories.includes('data-id="vip"'));assert.ok(categories.includes('data-id="skin"'));assert.ok(categories.includes('data-id="item"'));
 c.category='all';let html=t.ui.shop();assert.ok(!html.includes('product_room_quota'));assert.ok(!html.includes('product_vip'));assert.ok(html.includes('product_skin'));assert.ok(html.includes('product_item'));
 c.productId='vip';html=t.ui.shop();assert.ok(!html.includes('commerce-detail'));
 for(const kind of ['room_quota','vip']){await t.ui.handle('commerce-category',{dataset:{id:kind}});assert.equal(c.category,'all');await t.ui.handle('commerce-product',{dataset:{id:kind}});await t.ui.handle('commerce-buy',{dataset:{id:kind}});}
 assert.equal(t.calls.length,0);
 c.category='vip';t.ui.shop();assert.equal(c.category,'');
});


function ticketOffer(changes={}){
 return {id:'activation-32-sku',name:'賽事啟動券｜32 人',status:'published',purchasable:true,
  audience:'partner_organizer',version:4,priceTwd:300,
  delivery:{kind:'ticket',assetId:'32',quantity:1,durationDays:0},...changes};
}
test('an eligible ticket offer replaces its preview and uses its real checkout SKU',async()=>{
 const t=setup({partner:true});t.ui.shop();
 const c=t.ui.context();c.storeOpen=true;c.products=[ticketOffer()];
 await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 assert.equal((t.ui.shop().match(/尚未開放購買/g)||[]).length,4);
 await t.ui.handle('commerce-product',{dataset:{id:'tournament_activation_32'}});
 const details=t.ui.shop();
 assert.match(details,/有效合作主辦/);assert.match(details,/無使用期限/);
 assert.match(details,/data-action="commerce-buy"[^>]*>建立訂單｜NT\$ 300/);
 await t.ui.handle('commerce-buy',{dataset:{id:'tournament_activation_32'}});
 assert.deepEqual(t.calls,[{action:'create-order',productId:'activation-32-sku',expectedVersion:4,operationId:'same-operation'}]);
});
test('published PTN vouchers show their own capacity artwork even when catalog images repeat 32',()=>{
 const t=setup({partner:true});t.ui.shop();
 const c=t.ui.context();c.storeOpen=true;
 c.products=[32,64,96,128,160].map((capacity,index)=>ticketOffer({
  id:'sku-'+capacity,name:'賽事啟動券｜'+capacity+' 人',
  priceTwd:[300,600,1000,1500,2000][index],
  imageUrl:'https://example.invalid/32.png',
  delivery:{kind:'ticket',assetId:String(capacity),quantity:1,durationDays:0}
 }));
 c.category='ticket';const listing=t.ui.shop();
 for(const [capacity,color] of [[32,'green'],[64,'blue'],[96,'purple'],[128,'orange'],[160,'red']]){
  const filename='tournament-activation-'+capacity+'-'+color+'.png';
  assert.equal(listing.split(filename).length-1,1);
 }
 assert.ok(!listing.includes('https://example.invalid/32.png'));
 c.productId='tournament_activation_96';
 assert.ok(t.ui.shop().includes('class="commerce-hero" src="assets/commerce/tickets/tournament-activation-96-purple.png"'));
});
test('new PTN sale mode shows a permanent voucher and opens room creation without a BXH pilot URL',async()=>{
 const t=setup({partner:true});
 t.sandbox.window.BXH_PTN_TICKET_SALE=true;
 t.ui.shop();const c=t.ui.context();c.storeOpen=true;c.products=[ticketOffer()];
 await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 await t.ui.handle('commerce-product',{dataset:{id:'tournament_activation_32'}});
 assert.match(t.ui.shop(),/無使用期限/);
 t.sandbox.activeTab='management';
 await t.ui.handle('commerce-open-ticket-create',{});
 assert.equal(t.ui.ticketPilot(),true);
 c.ptnStatus={ok:true,code:null,canCreate:true};
 c.tickets=[{id:'permanent-ticket',capacity:32,status:'available',expiresAt:null}];
 assert.match(t.ui.ticketCreationPage(),/data-id="permanent-ticket"[^>]*><strong>32 人/);
 await t.ui.handle('commerce-ticket-bind',{dataset:{id:'permanent-ticket'}});
 assert.equal(c.ticketDraft.ticket.id,'permanent-ticket');
});
test('player mode hides ticket categories, catalog results, details and wallet',async()=>{
 const t=setup();t.ui.shop();const c=t.ui.context();const id='tournament_activation_32';
 c.storeOpen=true;c.products=[ticketOffer(),{id:'skin',name:'一般外觀',delivery:{kind:'skin'}}];
 assert.doesNotMatch(t.ui.shop(),/data-id="ticket"/);
 await t.ui.handle('commerce-category',{dataset:{id:'all'}});
 await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 assert.equal(c.category,'all');
 let html=t.ui.shop();
 assert.match(html,/一般外觀/);
 assert.doesNotMatch(html,/賽事啟動券|我的啟動券/);
 await t.ui.handle('commerce-product',{dataset:{id}});
 await t.ui.handle('commerce-buy',{dataset:{id}});
 await t.ui.handle('commerce-open-tickets',{});
 await t.ui.load('my-tickets');
 assert.ok(!c.productId);
 assert.equal(t.calls.length,0);
 t.setPartner(true);
 await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 await t.ui.handle('commerce-open-tickets',{});
 assert.match(t.ui.shop(),/我的啟動券/);
 t.setPartner(false);
 html=t.ui.shop();
 assert.doesNotMatch(html,/賽事啟動券|我的啟動券/);
 assert.equal(c.ticketsOpen,false);
});

test('ineligible offers and closed checkout cannot create a partner ticket order',async()=>{
 const t=setup({partner:true});t.ui.shop();const c=t.ui.context();const id='tournament_activation_32';
 c.storeOpen=true;c.products=[ticketOffer({purchasable:false,unavailableReason:'partner-organizer-required'})];
 await t.ui.handle('commerce-product',{dataset:{id}});
 assert.match(t.ui.shop(),/此商品限授權有效的合作主辦購買/);
 await t.ui.handle('commerce-buy',{dataset:{id}});
 c.storeOpen=false;c.products=[ticketOffer()];
 await t.ui.handle('commerce-buy',{dataset:{id}});
 c.storeOpen=true;c.products=[ticketOffer({audience:'all'}),ticketOffer({status:'draft'})];
 await t.ui.handle('commerce-buy',{dataset:{id}});
 assert.equal(t.calls.length,0);
 assert.match(t.ui.shop(),/尚未開放購買/);
});

test('my tickets shows an owned bound ticket, and resets on account switch',async()=>{
 const t=setup({partner:true});t.ui.shop();await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 assert.match(t.ui.shop(),/我的啟動券/);
 await t.ui.handle('commerce-open-tickets',{});
 t.sandbox.window.engagementService.commerce=async p=>{
  t.calls.push(p);return {ok:true,tickets:[{id:'ticket-a',status:'reserved',capacity:32,boundRoomCode:'BXH-FIXTURE',expiresAt:Date.parse('2026-12-19T12:00:00Z')}]};
 };
 await t.ui.load('my-tickets');
 const html=t.ui.shop();assert.match(html,/已綁定房間 BXH-FIXTURE/);assert.match(html,/2026\/12\/19/);
 assert.equal(t.calls[0].action,'my-tickets');
 t.setUid('other');assert.doesNotMatch(t.ui.shop(),/BXH-FIXTURE/);
 assert.equal(t.ui.context().tickets,null);
});

for(const ptn of [false,true])test(`${ptn?'PTN':'BXH'} event management offers five capacities and binds the first valid held ticket`,async()=>{
 const t=setup({partner:true}),code=ptn?'PTN-TST001':'BXH-TICKETTEST',now=Date.now(),operations=[];
 t.sandbox.activeTab='management';
 assert.equal(t.ui.ticketPilot(),false);
 await t.ui.handle('commerce-open-ticket-create',{});
 assert.equal(t.ui.ticketCreationPage(),null);
 t.sandbox.window.BXH_TICKET_ROOM_PILOT_CODE='BXH-TICKETTEST';
 t.sandbox.window.BXH_TICKET_ROOM_PTN_PILOT=ptn;
 t.setPartner(false);
 await t.ui.handle('commerce-open-ticket-create',{});
 assert.equal(t.ui.ticketCreationPage(),null);
 t.setPartner(true);
 await t.ui.handle('commerce-open-ticket-create',{});
 t.sandbox.window.engagementService.ticketRoomOperation=async p=>{
  operations.push(p);
  if(p.action==='ticket-ptn-status')return {ok:true,code:null};
  if(p.action==='ticket-room-state')return {ok:true,code,name:'試點賽事',phase:'live',ticketStatus:'consumed'};
  return {ok:true,code};
 };
 if(ptn)await t.ui.load('ticket-ptn-status');
 const c=t.ui.context();
 c.tickets=[
  {id:'later',capacity:64,status:'available',expiresAt:now+20000},
  {id:'first',capacity:64,status:'available',expiresAt:now+10000},
  {id:'expired',capacity:96,status:'available',expiresAt:now-1},
  {id:'used',capacity:128,status:'used',expiresAt:now+10000}
 ];
 const picker=t.ui.ticketCreationPage();
 assert.match(picker,/新增賽事｜選券建房/);
 assert.equal((picker.match(/data-action="commerce-ticket-bind"/g)||[]).length,5);
 assert.equal((picker.match(/data-id="" disabled/g)||[]).length,4);
 assert.match(picker,/data-id="first" [^>]*><strong>64 人/);
 await t.ui.handle('commerce-ticket-bind',{dataset:{id:'expired'}});
 assert.equal(c.ticketDraft,null);
 await t.ui.handle('commerce-ticket-bind',{dataset:{id:'first'}});
 assert.match(t.ui.ticketCreationPage(),/正取上限 64 人/);
 t.sandbox.FormData=function(form){return Object.entries(form.values);};
 const form={dataset:{commerceForm:'ticket-room'},values:{name:'測試賽事',location:'台南',stations:'2',
  registrationOpenAt:'2026-11-21T09:00',registrationCloseAt:'2026-11-21T10:00',startAt:'2026-11-21T11:00'}};
 await t.listeners.submit({target:{closest:()=>form},preventDefault(){}});
 const sent=operations.find(operation=>operation.action==='create-ticket-room');
 assert.equal(sent.code,ptn?undefined:code);
 assert.equal(sent.ticketId,'first');
 assert.match(t.ui.ticketCreationPage(),/已建房並綁定啟動券/);
 if(ptn){
  await t.ui.load('ticket-room-state');
  assert.equal(operations.at(-1).code,code);
  assert.match(t.ui.ticketCreationPage(),/房號<\/div><div class="value small">PTN-TST001/);
  assert.match(t.ui.ticketCreationPage(),/比賽中/);
  assert.match(t.ui.ticketCreationPage(),/已扣用 1 張啟動券/);
 }
 await t.ui.handle('commerce-ticket-back',{});
 await t.ui.handle('commerce-close-ticket-create',{});
 assert.equal(t.ui.ticketCreationPage(),null);
});
test('an existing PTN room does not block selecting a second available ticket',async()=>{
 const t=setup({partner:true});t.sandbox.activeTab='management';
 t.sandbox.window.BXH_TICKET_ROOM_PILOT_CODE='BXH-TICKETTEST';
 t.sandbox.window.BXH_TICKET_ROOM_PTN_PILOT=true;
 await t.ui.handle('commerce-open-ticket-create',{});
 const c=t.ui.context();c.ptnStatus={ok:true,code:'PTN-E50A3E'};
 c.tickets=[{id:'another-ticket',capacity:32,status:'available',expiresAt:Date.now()+86400000}];
 const picker=t.ui.ticketCreationPage();
 assert.match(picker,/最近建立的 PTN 房間｜PTN-E50A3E/);
 assert.match(picker,/data-id="another-ticket"[^>]*><strong>32 人/);
 await t.ui.handle('commerce-ticket-bind',{dataset:{id:'another-ticket'}});
 assert.equal(c.ticketDraft.ticket.id,'another-ticket');
});

test('scoped ticket room form uses Taiwan time and replays the exact V2 start request',async()=>{
 const t=setup({partner:true});const c=t.ui.context(),code='BXH-TICKETTEST',roomId='ticket-fixture-generation';
 const room={ok:true,code,roomId,name:'測試賽事',phase:'waiting',eligibleCount:2,rosterRevision:5,drawId:null,startAt:Date.now()+60000};
 const operations=[];let failStart=true;
 t.sandbox.FormData=function(form){return Object.entries(form.values);};
 t.sandbox.window.engagementService.ticketRoomOperation=async payload=>{
  operations.push(JSON.parse(JSON.stringify(payload)));
  if(payload.action==='ticket-room-state')return {...room};
  if(payload.action==='create-ticket-room')return {ok:true,code,roomId};
  if(payload.action==='ticket-room-draw'){room.drawId='draw-fixture';return {ok:true,drawId:room.drawId};}
  if(failStart){failStart=false;throw Error('network-timeout');}
  room.phase='live';return {ok:true,startedAt:Date.now()};
 };
 t.ui.shop();await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 await t.ui.handle('commerce-open-tickets',{});
 c.tickets=[{id:'fixture-ticket',status:'available',capacity:32,expiresAt:Date.now()+86400000}];
 assert.doesNotMatch(t.ui.shop(),/選這張券建房/);
 t.sandbox.window.BXH_TICKET_ROOM_PILOT_CODE=code;
 await t.ui.handle('commerce-ticket-bind',{dataset:{id:'fixture-ticket'}});
 assert.match(t.ui.shop(),/正取上限 32 人/);
 const form={dataset:{commerceForm:'ticket-room'},values:{name:'測試賽事',location:'台南',stations:'2',
  registrationOpenAt:'2026-11-21T09:00',registrationCloseAt:'2026-11-21T10:00',startAt:'2026-11-21T11:00'}};
 await t.listeners.submit({target:{closest:()=>form},preventDefault(){}});
 assert.equal(operations[0].startAt,Date.parse('2026-11-21T11:00:00+08:00'));
 assert.equal(operations[0].ticketId,'fixture-ticket');
 assert.equal('capacity' in operations[0],false);
 await t.ui.load('ticket-room-state');
 await t.ui.handle('commerce-ticket-draw',{});
 assert.equal(operations[2].rosterRevision,5);
 await t.ui.load('ticket-room-state');
 await t.ui.handle('commerce-ticket-start',{});
 assert.equal(c.pending.payload.drawId,'draw-fixture');
 assert.equal(c.pending.payload.roomId,roomId);
 assert.equal(c.pending.payload.confirmEarlyStart,true);
 await t.ui.handle('commerce-retry',{});
 assert.deepEqual(operations.at(-2),operations.at(-1));
 await t.ui.load('ticket-room-state');
 assert.match(t.ui.shop(),/房號<\/div><div class="value small">BXH-TICKETTEST/);
 assert.match(t.ui.shop(),/比賽中/);
});

test('ticket organizer can remove an entrant before start and must redraw',async()=>{
 const t=setup({partner:true}),code='BXH-TICKETTEST',calls=[];
 const room={ok:true,code,roomId:'test-ticket-room',phase:'waiting',name:'Fixture',eligibleCount:3,
  rosterRevision:4,drawId:'old-draw',drawReady:true,participants:[{registrationId:'entry-1',name:'參賽者甲'}]};
 t.sandbox.window.BXH_TICKET_ROOM_PILOT_CODE=code;
 t.sandbox.window.engagementService.ticketRoomOperation=async payload=>{
  calls.push(payload);
  if(payload.action==='ticket-room-state')return {...room};
  if(payload.action==='ticket-room-remove'){
   room.participants=[];room.eligibleCount=2;room.rosterRevision++;room.drawReady=false;
   return {ok:true};
  }
  throw Error('unexpected-action');
 };
 t.ui.shop();await t.ui.handle('commerce-open-tickets',{});
 await t.ui.handle('commerce-ticket-room',{});
 assert.match(t.ui.shop(),/參賽者甲/);
 await t.ui.handle('commerce-ticket-remove',{dataset:{id:'entry-1'}});
 assert.equal(calls.at(-1).registrationId,'entry-1');
 await t.ui.load('ticket-room-state');
 assert.match(t.ui.shop(),/名單已變更，請重新抽籤/);
 await t.ui.handle('commerce-ticket-start',{});
 assert.equal(calls.filter(p=>p.action==='ticket-room-start').length,0);
 room.phase='live';await t.ui.load('ticket-room-state');
 assert.doesNotMatch(t.ui.shop(),/commerce-ticket-remove/);
});

test('ticket organizer can record a single match forfeit only after start',async()=>{
 const t=setup({partner:true}),code='BXH-TICKETTEST',calls=[];
 const match={id:'match-1',seq:0,round:0,a:{id:'a',name:'選手甲'},b:{id:'b',name:'選手乙'},updatedAt:123};
 const room={ok:true,code,roomId:'test-ticket-room',phase:'waiting',name:'Fixture',eligibleCount:2,
  rosterRevision:4,drawId:'draw',drawReady:true,matches:[match]};
 t.sandbox.window.BXH_TICKET_ROOM_PILOT_CODE=code;
 t.sandbox.window.engagementService.ticketRoomOperation=async payload=>{
  calls.push(JSON.parse(JSON.stringify(payload)));
  return payload.action==='ticket-room-state'?{...room}:{ok:true};
 };
 t.ui.shop();await t.ui.handle('commerce-open-tickets',{});
 t.ui.context().tickets=[];
 assert.match(t.ui.shop(),/管理試點賽事/);
 await t.ui.handle('commerce-ticket-room',{});
 const target={dataset:{id:match.id,side:'b'}};
 await t.ui.handle('commerce-ticket-forfeit',target);
 assert.equal(calls.length,1);
 room.phase='live';await t.ui.load('ticket-room-state');
 assert.match(t.ui.shop(),/選手乙 棄權/);
 await t.ui.handle('commerce-ticket-forfeit',target);
 assert.deepEqual(calls.at(-1),{action:'ticket-room-forfeit',code,roomId:room.roomId,matchId:match.id,
  playerId:'b',opponentId:'a',matchUpdatedAt:123,operationId:'same-operation'});
 assert.match(t.ui.shop(),/已登記棄權，對手晉級/);
});

test('partner can recover their PTN room from management without a pilot URL',async()=>{
 const t=setup({partner:true}),code='PTN-TST001',calls=[];
 t.sandbox.activeTab='management';
 t.sandbox.window.engagementService.ticketRoomOperation=async request=>{
  calls.push({...request});
  if(request.action==='ticket-ptn-status')return {ok:true,code};
  return {ok:true,code,name:'合作主辦測試賽事',phase:'waiting',eligibleCount:2,ticketStatus:'reserved'};
 };
 assert.equal(t.ui.ticketPilot(),false);
 await t.ui.handle('commerce-refresh-owned-ptn');
 assert.match(t.ui.ownedTicketRoomCard(),/PTN-TST001/);
 await t.ui.handle('commerce-open-owned-ptn',{dataset:{id:'PTN-OTHER1'}});
 assert.deepEqual(calls,[{action:'ticket-ptn-status'},{action:'ticket-room-state',code}]);
 assert.match(t.ui.ticketManagedTab('registrations'),/啟動券已綁定/);
 assert.deepEqual(JSON.parse(JSON.stringify(t.ui.ticketManagementContext())),{code,phase:'waiting',verified:true});
 assert.equal(t.sandbox.activeTab,'registrations');
 assert.doesNotMatch(t.ui.ticketManagedTab('registrations'),/commerce-ticket-open-manage/);
 assert.match(t.ui.ticketManagedTab('registrations'),/正式開賽並扣券/);
 assert.doesNotMatch(t.ui.ticketManagedTab('registrations'),/票券房管理/);
 t.sandbox.activeTab='management';
 await t.ui.handle('commerce-ticket-back');
 assert.equal(t.ui.ticketCreationPage(),null);
 assert.equal(t.ui.ticketManagementContext(),null);
 assert.match(t.ui.ownedTicketRoomCard(),/PTN-TST001/);
 t.setPartner(false);
 assert.equal(t.ui.ownedTicketRoomCard(),'');
 t.setPartner(true);
 t.setUid('different-user');
 assert.doesNotMatch(t.ui.ownedTicketRoomCard(),/房號 PTN-TST001/);
});

test('partner can leave a PTN management tab and select an earlier bound room',async()=>{
 const t=setup({partner:true}),latest='PTN-64ROOM',earlier='PTN-32ROOM',calls=[];
 t.sandbox.activeTab='management';
 t.sandbox.window.engagementService.ticketRoomOperation=async request=>{
  calls.push({...request});
  return request.action==='ticket-ptn-status'?{ok:true,code:latest}
   :{ok:true,code:request.code,name:request.code,phase:'waiting',capacity:request.code===latest?64:32,
     eligibleCount:0,registrationOpenAt:Date.now()-60000,registrationCloseAt:Date.now()+3600000,
     startAt:Date.now()+7200000,ticketStatus:'reserved'};
 };
 t.sandbox.window.engagementService.commerce=async()=>({ok:true,tickets:[
  {id:'first',capacity:32,status:'reserved',boundRoomCode:earlier},
  {id:'second',capacity:64,status:'reserved',boundRoomCode:latest}]});
 await t.ui.handle('commerce-refresh-owned-ptn');
 await t.ui.load('my-tickets');
 await t.ui.handle('commerce-open-owned-ptn');
 assert.equal(t.sandbox.activeTab,'registrations');
 t.sandbox.activeTab='people';
 assert.match(t.ui.ticketManagedTab('people'),/data-action="commerce-ticket-back"/);
 await t.ui.handle('commerce-ticket-back');
 assert.equal(t.sandbox.activeTab,'management');
 assert.equal(t.ui.ticketManagementContext(),null);
 await t.ui.load('my-tickets');
 await t.ui.loadPtnRoomCards();
 const cards=t.ui.ownedTicketRoomCard();
 assert.match(cards,/PTN-32ROOM/);
 assert.match(cards,/正取 0 \/ 32 人/);
 assert.match(cards,/正取 0 \/ 64 人/);
 assert.match(cards,/data-id="PTN-32ROOM">進入管理/);
 await t.ui.handle('commerce-open-ticket-room',{dataset:{id:earlier}});
 assert.equal(t.ui.ticketManagementContext().code,earlier);
 assert.equal(t.sandbox.activeTab,'registrations');
 assert.match(t.ui.ticketManagedTab('registrations'),/報名資訊/);
 assert.deepEqual(calls.filter(request=>request.action==='ticket-room-state').map(request=>request.code),[latest,latest,earlier,earlier]);
});

test('PTN small cards show verified room facts, escape names and retain entry on a failed read',async()=>{
 const t=setup({partner:true});t.sandbox.activeTab='management';
 const code='PTN-CARD01',failed='PTN-FAIL01';
 t.sandbox.window.engagementService.commerce=async()=>({ok:true,tickets:[
  {id:'one',capacity:64,boundRoomCode:code},{id:'two',capacity:32,boundRoomCode:failed}]});
 t.sandbox.window.engagementService.ticketRoomOperation=async ({code:roomCode})=>{
  if(roomCode===failed)throw Error('unavailable');
  return {ok:true,code:roomCode,name:'64測試<script>',location:'實驗室',phase:'waiting',capacity:64,confirmedCount:12,
   registrationEnabled:true,registrationOpenAt:Date.now()-1000,registrationCloseAt:Date.now()+60000};
 };
 await t.ui.load('my-tickets');await t.ui.loadPtnRoomCards();
 const html=t.ui.ownedTicketRoomCard();
 assert.match(html,/64測試&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/房號 PTN-CARD01｜實驗室/);
 assert.match(html,/正取 12 \/ 64 人｜報名中/);
 assert.match(html,/房號 PTN-FAIL01/);
 assert.match(html,/正取 — \/ 32 人｜資料讀取中/);
 assert.match(html,/data-id="PTN-FAIL01">進入管理/);
 t.setUid('another-user');assert.equal(Object.keys(t.ui.context().ptnRoomCards).length,0);
});

test('PTN discovery reports its read error and keeps manual room takeover available',async()=>{
 const t=setup({partner:true});
 t.sandbox.activeTab='management';
 t.sandbox.window.engagementService.ticketRoomOperation=async()=>{
  throw Object.assign(Error('INTERNAL'),{code:'functions/internal'});
 };
 await t.ui.handle('commerce-refresh-owned-ptn');
 assert.match(t.ui.ownedTicketRoomCard(),/賽事服務處理失敗（internal）/);
 assert.match(t.ui.ownedTicketRoomCard(),/data-commerce-form="ticket-open-code"/);
});

test('PTN management read shows the actual failure class instead of a checkout retry message',async()=>{
 const t=setup({partner:true}),code='PTN-TST001';
 t.sandbox.activeTab='management';
 let failure='permission-denied';
 t.sandbox.window.engagementService.ticketRoomOperation=async request=>{
  if(request.action==='ticket-ptn-status')return {ok:true,code};
  throw Error(failure);
 };
 await t.ui.handle('commerce-refresh-owned-ptn');
 await t.ui.handle('commerce-open-owned-ptn');
 assert.match(t.ui.ticketCreationPage(),/管理權限驗證失敗/);
 assert.doesNotMatch(t.ui.ticketCreationPage(),/重複下單/);
 failure='app-check-unavailable';
 await t.ui.load('ticket-room-state');
 assert.match(t.ui.ticketCreationPage(),/網站驗證未完成/);
 failure='deadline-exceeded';
 await t.ui.load('ticket-room-state');
 assert.match(t.ui.ticketCreationPage(),/賽事資料讀取逾時/);
});

test('PTN draw permission refusal reports authorization and clears the pending receipt',async()=>{
 const t=setup({partner:true}),c=t.ui.context(),code='PTN-DRAW01';
 t.sandbox.activeTab='management';
 c.view='ticket-manage';c.ownedPtn={code};c.ticketRoomOpen=true;
 c.ticketRoom={ok:true,code,roomId:'room-generation',phase:'waiting',eligibleCount:2,rosterRevision:1,drawId:null};
 t.sandbox.window.engagementService.ticketRoomOperation=async()=>{throw Error('permission-denied functions/permission-denied');};
 await t.ui.handle('commerce-ticket-draw',{});
 assert.match(c.error,/賽事管理權限驗證失敗/);
 assert.doesNotMatch(c.error,/重複下單/);
 assert.equal(c.pending,null);
 assert.equal(t.storage.size,0);
});
test('PTN takeover replaces stale legacy header only after server owner verification',async()=>{
 const t=setup({partner:true}),code='PTN-TST001';
 t.sandbox.activeTab='management';
 t.sandbox.window.BXHTournamentEntryUtils={buildTournamentEntryUrl:code=>`https://arena.bxh.com.tw/?code=${code}&entry=register`};
 t.sandbox.window.engagementService.ticketRoomOperation=async request=>request.action==='ticket-ptn-status'
  ?{ok:true,code}:{ok:true,code,name:'測試',phase:'waiting',eligibleCount:0,drawId:null,ticketStatus:'reserved',
   registrationOpenAt:Date.now()-60000,registrationCloseAt:Date.now()-1000,startAt:Date.now()+3600000,updatedAt:123};
 await t.ui.handle('commerce-refresh-owned-ptn');
 assert.equal(t.ui.ticketManagementContext(),null);
 await t.ui.handle('commerce-open-owned-ptn',{});
 assert.equal(t.ui.ticketManagementContext().code,code);
 assert.equal(t.sandbox.activeTab,'registrations');
 assert.doesNotMatch(t.ui.ticketManagedTab('registrations'),/commerce-ticket-open-manage/);
 assert.equal(t.ui.ticketManagementContext().code,code);
 assert.match(t.ui.ticketManagedTab('registrations'),/報名資訊/);
 assert.match(t.ui.ticketManagedTab('registrations'),/報名已截止/);
 assert.match(t.ui.ticketManagedTab('registrations'),/disabled>抽籤/);
 t.sandbox.activeTab='settings';
 assert.match(t.ui.ticketManagedTab('settings'),/合作主辦設定/);
 assert.match(t.ui.ticketManagedTab('settings'),/調整報名與開賽時間/);
 assert.match(t.ui.ticketManagedTab('settings'),/儲存賽事時間/);
 assert.doesNotMatch(t.ui.ticketManagedTab('settings'),/查看玩家報名頁|entry=register/);
 t.sandbox.activeTab='referee';
 assert.match(t.ui.ticketManagedTab('referee'),/賽事尚未開賽/);
 t.ui.context().ticketRoom={...t.ui.context().ticketRoom,drawId:'draw-preview',drawReady:true,
  bracket:[{id:'preview-1',seq:0,round:0,a:{name:'甲'},b:{name:'乙'},scoreA:0,scoreB:0,canScore:false}]};
 t.sandbox.activeTab='bracket';
 assert.match(t.ui.ticketManagedTab('bracket'),/id="board-viewport"/);
 assert.doesNotMatch(t.ui.ticketManagedTab('bracket'),/抽籤預覽/);
 assert.match(t.ui.ticketManagedTab('bracket'),/甲/);
 t.sandbox.activeTab='live';
 assert.match(t.ui.ticketManagedTab('live'),/正式開賽後顯示即時戰況/);
 const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
 assert.match(core,/ticketManagementContext\?\.\(\)/);
 assert.match(core,/票券賽事 \$\{esc\(ticket\.code\)\}/);
 assert.match(core,/ticketManagedTab\?\.\('registrations'\)/);
 assert.match(core,/ticketManagedTab\?\.\('settings'\)/);
 t.setUid('another-owner');
 assert.equal(t.ui.ticketManagementContext(),null);
});
test('PTN live takeover shows bracket and scores only its verified room',async()=>{
 const t=setup({partner:true}),code='PTN-TST001',calls=[];
 t.sandbox.activeTab='management';
 const match={id:'round-one',seq:0,round:0,station:1,scoreA:3,scoreB:0,updatedAt:123,
  canScore:true,a:{id:'a',name:'甲'},b:{id:'b',name:'乙'}};
 t.sandbox.window.engagementService.ticketRoomOperation=async payload=>{
  calls.push(JSON.parse(JSON.stringify(payload)));
  return payload.action==='ticket-ptn-status'?{ok:true,code}:payload.action==='ticket-room-state'
   ?{ok:true,code,roomId:'ticket-room-generation',name:'測試',phase:'live',bracket:[match],matches:[]}
   :{ok:true,scoreA:4,scoreB:0,completed:false};
 };
 await t.ui.handle('commerce-refresh-owned-ptn');
 await t.ui.handle('commerce-open-owned-ptn',{});
 assert.equal(t.sandbox.activeTab,'registrations');
 t.sandbox.activeTab='bracket';
 assert.match(t.ui.ticketManagedTab('bracket'),/class="nm">甲<\/span>.*class="sc">3<\/span>/);
 t.sandbox.activeTab='referee';
 const panel=t.ui.ticketManagedTab('referee');
 assert.match(panel,/court-grid court-grid-1 commerce-ptn-courts/);
 assert.match(panel,/ref-vs-arena standard/);
 assert.match(panel,/旋轉勝利＋1分/);
 assert.match(panel,/擊飛勝利＋2分/);
 assert.match(panel,/爆裂勝利＋2分/);
 assert.match(panel,/極限勝利＋3分/);
 assert.match(panel,/撤回上一筆得分/);
 assert.match(panel,/data-command="confirm" disabled/);
 assert.equal((panel.match(/data-command="score"/g)||[]).length,8);
 await t.ui.handle('commerce-ticket-score',{dataset:{id:match.id,command:'score',side:'A',finish:'spin'}});
 assert.deepEqual(calls.findLast(call=>call.action==='ticket-room-score'),{action:'ticket-room-score',code,roomId:'ticket-room-generation',
  matchId:match.id,matchUpdatedAt:123,command:'score',side:'A',finish:'spin',operationId:'same-operation'});
 assert.equal(t.ui.context().ticketRoom?.code,code);
 const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
 assert.match(core,/renderStableRefereeScreen\(app,html,'ptn:'/);
 t.setUid('another-user');
 assert.equal(t.ui.ticketManagementContext(),null);
});
test('PTN official-style score panel locks scoring at four and recommends the winning side',()=>{
 const t=setup({partner:true}),code='PTN-TST001';
 t.sandbox.activeTab='referee';
 const c=t.ui.context();c.view='ticket-manage';c.ownedPtn={code};c.ticketRoomOpen=true;c.roomManageOpen=true;
 c.ticketRoom={ok:true,code,name:'測試',phase:'live',bracket:[{id:'m1',round:0,seq:0,station:1,
  canScore:true,scoreA:1,scoreB:4,a:{name:'甲'},b:{name:'乙'}}]};
 const panel=t.ui.ticketManagedTab('referee');
 assert.match(panel,/待確認賽果/);
 assert.match(panel,/建議：乙 勝/);
 assert.match(panel,/data-command="confirm" >確認比賽結果/);
 assert.equal((panel.match(/data-command="score"[^>]*disabled/g)||[]).length,8);
 assert.doesNotMatch(panel,/data-action="score"|data-command="fault"|本局重賽/);
});
test('PTN live dashboard and bracket tree show court progress and actual advancement links',()=>{
 const t=setup({partner:true}),code='PTN-TST001';
 const c=t.ui.context();c.view='ticket-manage';c.ownedPtn={code};c.ticketRoomOpen=true;c.roomManageOpen=true;
 const player=name=>({name});
 c.ticketRoom={ok:true,code,name:'四人測試',phase:'live',confirmedCount:4,eligibleCount:4,
  bracket:[
   {id:'s1',round:0,seq:0,bracket:'SE',station:1,completed:true,scoreA:4,scoreB:2,a:player('甲'),b:player('乙')},
   {id:'s2',round:0,seq:1,bracket:'SE',station:2,completed:true,scoreA:0,scoreB:4,a:player('丙'),b:player('丁')},
   {id:'final',round:1,seq:2,bracket:'SE',station:1,scoreA:0,scoreB:0,a:player('甲'),b:player('丁')}]
 };
 t.sandbox.activeTab='live';
 const live=t.ui.ticketManagedTab('live');
 assert.match(live,/live-dashboard-panel/);
 assert.match(live,/已完成 2 \/ 3 場/);
 assert.match(live,/甲<\/span><strong>0 : 0<\/strong><span>丁/);
 assert.doesNotMatch(live,/第 1 輪・第 1 場<\/strong>/);
 t.sandbox.activeTab='bracket';
 const tree=t.ui.ticketManagedTab('bracket');
 assert.match(tree,/se-bracket-svg/);
 assert.match(tree,/data-round="0" data-index="0"/);
 assert.match(tree,/data-round="0" data-index="1"/);
 assert.match(tree,/冠亞/);
 assert.doesNotMatch(tree,/data-action="open-match"/);
});
test('PTN room tabs keep the official navigation and completed rosters read-only without repeating the room summary',()=>{
 const t=setup({partner:true}),code='PTN-TST001';
 const c=t.ui.context();c.view='ticket-manage';c.ownedPtn={code};c.ticketRoomOpen=true;c.roomManageOpen=true;
 c.ticketRoom={ok:true,code,name:'合作賽<script>',location:'台南',capacity:32,confirmedCount:2,
  eligibleCount:2,phase:'done',participants:[{name:'甲'},{name:'乙'}],championName:'甲',
  bracket:[{id:'final',round:0,seq:0,completed:true,scoreA:4,scoreB:2,
   a:{name:'甲'},b:{name:'乙'}}]};
 t.sandbox.activeTab='people';
 const people=t.ui.ticketManagedTab('people');
 assert.match(people,/commerce-ptn-management/);
 assert.doesNotMatch(people,/人員管理｜|ptn-room-card-heading|賽事地點/);
 assert.match(people,/正取選手（2 \/ 32）/);
 assert.match(people,/aria-label="人員管理分類"/);
 assert.match(people,/people-roster-table/);
 assert.match(people,/data-id="pending"/);
 assert.match(people,/data-id="staff"/);
 assert.match(people,/甲/);
 assert.doesNotMatch(people,/data-action="commerce-ticket-remove"|合作賽<script>/);
 t.sandbox.activeTab='bracket';
 const bracket=t.ui.ticketManagedTab('bracket');
 assert.match(bracket,/se-finals-champion-card/);
 assert.match(bracket,/class="board-champion-name">甲<\/div>/);
 assert.match(bracket,/已完成/);
 assert.doesNotMatch(bracket,/對戰表｜|ptn-room-card-heading/);
 t.sandbox.activeTab='operations';
 const operations=t.ui.ticketManagedTab('operations');
 assert.match(operations,/自動結算/);
 assert.doesNotMatch(operations,/data-action="archive-complete"|尚未接入合作賽事/);
});
test('PTN people panel switches official sections without crossing rooms or offering unsupported roster writes',async()=>{
 const t=setup({partner:true}),code='PTN-TST002';
 t.sandbox.activeTab='people';
 const c=t.ui.context();c.view='ticket-manage';c.ownedPtn={code};c.ticketRoomOpen=true;c.roomManageOpen=true;
 c.ticketRoom={ok:true,code,name:'測試',phase:'waiting',capacity:32,confirmedCount:2,eligibleCount:2,
  participants:[{name:'甲',registrationId:'entry-1'},{name:'乙',registrationId:'entry-2'}]};
 let html=t.ui.ticketManagedTab('people');
 assert.match(html,/data-action="commerce-ticket-remove"/);
 assert.match(html,/data-id="entry-1"/);
 await t.ui.handle('commerce-ticket-people-section',{dataset:{id:'tools'}});
 html=t.ui.ticketManagedTab('people');
 assert.match(html,/同步最新正取名單/);
 assert.doesNotMatch(html,/隨機 32 位|現場新增選手/);
 await t.ui.handle('commerce-ticket-people-section',{dataset:{id:'pending'}});
 assert.match(t.ui.ticketManagedTab('people'),/目前設定為免報到/);
 await t.ui.handle('commerce-ticket-people-section',{dataset:{id:'waitlist'}});
 assert.match(t.ui.ticketManagedTab('people'),/尚未啟用備取/);
 await t.ui.handle('commerce-ticket-people-section',{dataset:{id:'bracket'}});
 assert.match(t.ui.ticketManagedTab('people'),/抽籤與開賽/);
 await t.ui.handle('commerce-ticket-people-section',{dataset:{id:'invalid'}});
 assert.equal(c.peopleSection,'bracket');
});
test('PTN owner alone can assign one delegate and a super admin can enter by room code',async()=>{
 const t=setup(),code='PTN-AGENT1';
 t.setAdmin(true);t.sandbox.activeTab='management';
 assert.match(t.ui.ownedTicketRoomCard(),/代理或最高管理員接管 PTN 房號/);
 const c=t.ui.context();c.view='ticket-manage';c.ownedPtn={code};c.ticketRoomOpen=true;c.roomManageOpen=true;
 c.ticketRoom={ok:true,code,name:'房間',phase:'waiting',capacity:32,eligibleCount:0,confirmedCount:0,
  registrationOpenAt:Date.now()-1000,registrationCloseAt:Date.now()+3600000,startAt:Date.now()+7200000,
  delegateUid:'delegated-user',canAssignDelegate:true};
 t.sandbox.activeTab='settings';
 assert.match(t.ui.ticketManagedTab('settings'),/房間代理人（最多一名）/);
 assert.match(t.ui.ticketManagedTab('settings'),/搜尋本名或遊戲 ID/);
 assert.doesNotMatch(t.ui.ticketManagedTab('settings'),/帳號 UID|delegated-user/);
 assert.match(t.ui.ticketManagedTab('settings'),/撤銷代理權/);
 c.ticketRoom.canAssignDelegate=false;
 assert.doesNotMatch(t.ui.ticketManagedTab('settings'),/撤銷代理權/);
 c.ticketRoom.canAssignDelegate=true;
 const calls=[];
 t.sandbox.window.engagementService.ticketRoomOperation=async payload=>{calls.push(payload);return {ok:true};};
 c.delegateSearch={code,query:'同名',players:[{uid:'one',name:'同名',gameId:'alpha'},{uid:'two',name:'同名',gameId:'beta'}]};
 assert.match(t.ui.ticketManagedTab('settings'),/同名（alpha）/);
 assert.match(t.ui.ticketManagedTab('settings'),/同名（beta）/);
 await t.ui.handle('commerce-ticket-select-delegate',{dataset:{id:'1'}});
 assert.equal(calls[0].action,'ticket-room-delegate');
 assert.equal(calls[0].delegateUid,'two');
 assert.equal(c.delegateSearch,null);
 c.ticketRoom={ok:true,code,name:'房間',phase:'waiting',delegateUid:'delegated-user',canAssignDelegate:true};
 await t.ui.handle('commerce-ticket-revoke-delegate');
 assert.equal(calls.length,2);
 assert.equal(calls[1].action,'ticket-room-delegate');
 assert.equal(calls[1].delegateUid,null);
 assert.equal(calls[1].code,code);
});

test('PTN pre-start configured courts share the official waiting scorer without touching official state',()=>{
 const t=setup({partner:true}),c=t.ui.context(),code='PTN-TST001';
 c.view='ticket-manage';c.ownedPtn={code};c.ticketRoomOpen=true;c.roomManageOpen=true;
 c.ticketRoom={ok:true,code,roomId:'fixture-ptn',name:'測試',phase:'waiting',stations:4,eligibleCount:0};
 const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
 const extract=(start,end)=>core.slice(core.indexOf(start),core.indexOf(end,core.indexOf(start)));
 Object.assign(t.sandbox,{POINT_LABELS:{spin:'旋轉勝利＋1分',knockout:'擊飛勝利＋2分',burst:'爆裂勝利＋2分',extreme:'極限勝利＋3分'},refereeSwapControl:()=>'<button disabled>⇄</button>'});
 vm.runInContext(extract('function refereeWorkstationHeader(','function renderQuickDecisionPanel(')+extract('function courtAtmosphereStyle(','function renderCourtCard(')+extract('function renderRefereeScorePanel(','function renderSkippedMatches(')+extract('function renderWaitingRefereeCourt(','function canUseRefereeSyncRecovery('),t.sandbox);
 t.sandbox.activeTab='referee';
 const html=t.ui.ticketManagedTab('referee');
 assert.equal((html.match(/referee-workstation-waiting/g)||[]).length,4);
 assert.match(html,/台4/);assert.match(html,/等待開賽/);
 assert.doesNotMatch(html,/data-action="(?:score|fault|confirm-result|undo-score|rematch|commerce-ticket-score)"/);
 assert.equal((html.match(/data-type="spin" disabled/g)||[]).length,8);
 c.ticketRoom.stations=null;
 assert.doesNotMatch(t.ui.ticketManagedTab('referee'),/referee-workstation-waiting/);
});


test('one click reserves PTN navigation while checking the selected room and never falls back to ordinary tabs',async()=>{
 const t=setup({partner:true}),code='PTN-TST001';t.sandbox.activeTab='management';
 let resolve;const requests=[];
 t.sandbox.window.engagementService.ticketRoomOperation=request=>{requests.push(request);return new Promise(r=>resolve=r);};
 const pending=t.ui.handle('commerce-open-ticket-room',{dataset:{id:code}});
 assert.equal(t.ui.ticketManagementContext().verified,false);
 assert.match(t.ui.ticketCreationPage(),/正在驗證票券房管理權限/);
 t.sandbox.activeTab='people';
 assert.match(t.ui.ticketManagedTab('people'),/正在驗證票券房管理權限/);
 resolve({ok:true,code,phase:'waiting',name:'32人測試',capacity:32,participants:[{name:'選手甲'}]});await pending;
 assert.equal(t.sandbox.activeTab,'people');
 assert.match(t.ui.ticketManagedTab('people'),/選手甲/);
 assert.equal(requests.length,1);
});

test('failed PTN verification can retry once from the same management screen without a second management click',async()=>{
 const t=setup({partner:true}),code='PTN-TST001';t.sandbox.activeTab='management';
 let ok=false;t.sandbox.window.engagementService.ticketRoomOperation=async()=>{if(!ok)throw Error('unavailable');return {ok:true,code,phase:'waiting'};};
 await t.ui.handle('commerce-open-ticket-room',{dataset:{id:code}});
 assert.equal(t.sandbox.activeTab,'management');assert.equal(t.ui.ticketManagementContext().verified,false);
 assert.match(t.ui.ticketCreationPage(),/commerce-ticket-refresh/);
 ok=true;await t.ui.handle('commerce-ticket-refresh');
 assert.equal(t.sandbox.activeTab,'registrations');assert.equal(t.ui.ticketManagementContext().verified,true);
 assert.match(t.ui.ticketManagedTab('registrations'),/報名資訊/);
});

test('manual room code entry uses the same single verified navigation flow',async()=>{
 const t=setup({partner:true}),code='PTN-TST001';t.sandbox.activeTab='management';
 t.sandbox.FormData=function(form){return Object.entries(form.values);};
 t.sandbox.window.engagementService.ticketRoomOperation=async ({code:requested})=>({ok:true,code:requested,phase:'waiting'});
 const form={dataset:{commerceForm:'ticket-open-code'},values:{code:code.toLowerCase()}};
 await t.listeners.submit({target:{closest:()=>form},preventDefault(){}});
 assert.equal(t.sandbox.activeTab,'registrations');assert.equal(t.ui.ticketManagementContext().code,code);
 await t.ui.handle('commerce-ticket-back');assert.equal(t.sandbox.activeTab,'management');assert.equal(t.ui.ticketManagementContext(),null);
});

test('expansion ticket product is partner-only and checkout sends selected prepaid quantity',async()=>{
 const t=setup({partner:true}),c=t.ui.context();
 t.ui.shop();c.storeOpen=true;c.category='all';
 c.products=[{id:'tournament_expansion_1',name:'賽事擴充券',version:2,priceTwd:25,status:'published',audience:'partner_organizer',purchasable:true,delivery:{kind:'room_expansion',assetId:'tournament_expansion_1',quantity:1,durationDays:0}}];
 assert.match(t.ui.shop(),/tournament-expansion-1\.png/);
 t.setPartner(false);assert.doesNotMatch(t.ui.shop(),/tournament-expansion-1\.png/);
 t.setPartner(true);await t.ui.handle('commerce-product',{dataset:{id:'tournament_expansion_1'}});
 assert.match(t.ui.shop(),/data-expansion-quantity/);
 t.sandbox.document.querySelector=s=>s==='[data-expansion-quantity]'?{value:'5'}:{checked:true};
 c.storeOpen=false;await t.ui.handle('commerce-buy',{dataset:{id:'tournament_expansion_1'}});assert.equal(t.calls.length,0);
 c.storeOpen=true;await t.ui.handle('commerce-buy',{dataset:{id:'tournament_expansion_1'}});
 assert.equal(t.calls[0].quantity,5);assert.equal(t.calls[0].expectedVersion,2);
 assert.equal(t.calls[0].productId,'tournament_expansion_1');
 assert.equal(t.calls[0].roomCode,undefined);
});

test('owner sees room expansion balance and sends only chosen room generation and quantity',async()=>{
 const t=setup({partner:true}),c=t.ui.context(),code='PTN-EXP123';
 t.sandbox.activeTab='people';c.view='ticket-manage';c.ownedPtn={code};c.roomManageOpen=true;c.ticketRoomOpen=true;
 c.ticketRoom={ok:true,code,roomId:'room-generation',phase:'waiting',capacity:32,canAssignDelegate:true,expansionEnabled:true,expansionMaxCapacity:160};
 t.sandbox.window.engagementService.commerce=async p=>({ok:true,quantity:50});
 await t.ui.load('my-expansion-balance');
 assert.match(t.ui.ticketManagedTab('people'),/我的擴充券：50 張/);
 assert.match(t.ui.ticketManagedTab('people'),/擴充後正取上限：33 人/);
 const operations=[];
 t.sandbox.window.engagementService.ticketRoomOperation=async p=>{operations.push(JSON.parse(JSON.stringify(p)));return {ok:true,code,quantity:p.quantity,capacityAfter:40};};
 t.sandbox.FormData=function(form){return Object.entries(form.values);};
 const submit=async q=>t.listeners.submit({target:{closest:()=>({dataset:{commerceForm:'ticket-expand'},values:{quantity:String(q)}})},preventDefault(){}});
 await submit(51);assert.equal(operations.length,0);
 c.ticketRoom.canAssignDelegate=false;assert.doesNotMatch(t.ui.ticketManagedTab('people'),/使用擴充券/);await submit(8);assert.equal(operations.length,0);
 c.ticketRoom.canAssignDelegate=true;await submit(8);
 assert.deepEqual(operations,[{action:'ticket-room-expand',code,roomId:'room-generation',quantity:8,operationId:'same-operation'}]);
 assert.equal(c.expansionBalance,null);assert.equal(c.ticketRoom,null);
});
test('expansion admin draft uses the dedicated SKU and price; account switch clears balance',async()=>{
 const t=setup({partner:true});t.setAdmin(true);t.sandbox.activeTab='commerce-admin';t.ui.adminPage();
 await t.ui.handle('commerce-expansion-product',{});
 const c=t.ui.context();assert.equal(c.draft.id,'tournament_expansion_1');assert.equal(c.draft.priceTwd,20);assert.equal(c.draft.status,'draft');
 c.expansionBalance=50;t.setUid('other');assert.equal(t.ui.context().expansionBalance,undefined);
});
