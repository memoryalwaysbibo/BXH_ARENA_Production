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
 assert.equal((listing.match(/暫停購買/g)||[]).length,5);
 await t.ui.handle('commerce-product',{dataset:{id:'tournament_activation_64'}});
 const detail=t.ui.shop();assert.match(detail,/基本正取上限 64 人/);
 assert.match(detail,/<button class="btn btn-primary" disabled aria-disabled="true">暫停購買<\/button>/);
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
  delivery:{kind:'ticket',assetId:'32',quantity:1,durationDays:30},...changes};
}
test('an eligible ticket offer replaces its preview and uses its real checkout SKU',async()=>{
 const t=setup({partner:true});t.ui.shop();
 const c=t.ui.context();c.storeOpen=true;c.products=[ticketOffer()];
 await t.ui.handle('commerce-category',{dataset:{id:'ticket'}});
 assert.equal((t.ui.shop().match(/暫停購買/g)||[]).length,4);
 await t.ui.handle('commerce-product',{dataset:{id:'tournament_activation_32'}});
 const details=t.ui.shop();
 assert.match(details,/有效合作主辦/);assert.match(details,/30 天/);assert.match(details,/最多持有 2 張/);
 assert.match(details,/data-action="commerce-buy"[^>]*>建立訂單｜NT\$ 300/);
 await t.ui.handle('commerce-buy',{dataset:{id:'tournament_activation_32'}});
 assert.deepEqual(t.calls,[{action:'create-order',productId:'activation-32-sku',expectedVersion:4,operationId:'same-operation'}]);
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
 assert.match(t.ui.shop(),/暫停購買/);
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
