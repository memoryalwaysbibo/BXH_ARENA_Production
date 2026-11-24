'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../commerce-ui.js'),'utf8');
function setup({partner=false}={}){
 const storage=new Map(),calls=[],listeners={};let uid='buyer',epoch=1,admin=false,fail=false;
 const sandbox={window:{engagementService:{commerce:async p=>{calls.push(JSON.parse(JSON.stringify(p)));if(fail)throw Error('network-timeout');return {ok:true,order:{id:'ORDER_TEST'}};}}},currentAuthUid:()=>uid,get engagementSessionEpoch(){return epoch;},isSuperAdmin:()=>admin,isPartnerOrganizerMode:()=>partner,render(){},setTimeout(){},URL,Date,crypto:{randomUUID:()=> 'same-operation'},confirm:()=>true,esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{addEventListener:(k,f)=>listeners[k]=f,querySelector:()=>({checked:true})}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
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
  assert.match(t.ui.ticketCreationPage(),/PTN-TST001｜已開賽/);
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
 assert.match(t.ui.shop(),/BXH-TICKETTEST｜已開賽/);
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
 assert.match(t.ui.ticketCreationPage(),/已綁定啟動券/);
 assert.deepEqual(JSON.parse(JSON.stringify(t.ui.ticketManagementContext())),{code,phase:'waiting',verified:true});
 assert.match(t.ui.ticketCreationPage(),/data-action="commerce-ticket-open-manage"[^>]*>管理房間/);
 await t.ui.handle('commerce-ticket-open-manage');
 t.sandbox.activeTab='registrations';
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
 assert.match(t.ui.ticketCreationPage(),/管理房間/);
 await t.ui.handle('commerce-ticket-open-manage');
 t.sandbox.activeTab='registrations';
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
 await t.ui.handle('commerce-ticket-open-manage');
 t.sandbox.activeTab='bracket';
 assert.match(t.ui.ticketManagedTab('bracket'),/甲 3 : 0 乙/);
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
 assert.deepEqual(calls.at(-1),{action:'ticket-room-score',code,roomId:'ticket-room-generation',
  matchId:match.id,matchUpdatedAt:123,command:'score',side:'A',finish:'spin',operationId:'same-operation'});
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
