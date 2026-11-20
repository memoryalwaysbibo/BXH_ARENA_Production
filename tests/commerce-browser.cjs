'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const appSource=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const timeGuard=appSource.match(/document\.addEventListener\("change",\(e\)=>\{\n  const el=e\.target;\n  if\(!\(el instanceof HTMLInputElement\)\) return;\n  if\(el\.type!=="time"[\s\S]*?\}, true\);/)?.[0];
assert.ok(timeGuard,'Actual application time-change handler is required');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
 try{
 for(const width of [390,1280]){
  const ptn=width===390,expectedCode=ptn?'PTN-TEST32':'BXH-TICKETTEST';
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('https://commerce.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><body><main id="app"></main></body></html>'}));
  await page.route('https://example.invalid/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="350"><rect width="500" height="350" fill="#26313f"/><text x="250" y="180" text-anchor="middle" fill="#e4ca81" font-size="32">SKIN · TEST</text></svg>'}));
  if(process.env.COMMERCE_TEST_FONT)await page.route('https://commerce.test/font.otf',route=>route.fulfill({path:process.env.COMMERCE_TEST_FONT,contentType:'font/otf'}));
  await page.goto('https://commerce.test/');
  await page.addStyleTag({content:(process.env.COMMERCE_TEST_FONT?'@font-face{font-family:CommerceTestCJK;src:url(https://commerce.test/font.otf)}':'')+'body{margin:0;padding:16px;background:#0c1017;color:#eee;font:16px CommerceTestCJK,Arial}.panel{padding:18px;border:1px solid #3a414b;border-radius:14px;background:#151a22;box-sizing:border-box}.panel-title,.btn-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.btn{padding:10px 14px;border:1px solid #6b6554;background:#252c36;color:#eee;border-radius:10px;cursor:pointer}.btn-primary{background:#d7ba70;color:#12151b}.hint{color:#acb3bf}.empty-state{padding:24px}.banner{padding:14px;border:1px solid #d7ba70}'+fs.readFileSync(path.join(root,'commerce.css'),'utf8')});
  await page.evaluate(()=>{
   window.currentAuthUid=()=>window.testUid||'buyer';window.engagementSessionEpoch=1;window.isSuperAdmin=()=>!!window.testAdmin;window.isPartnerOrganizerMode=()=>window.testUid==='ticket_buyer';window.activeTab='';
   window.esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   window.testView='shop';window.render=()=>document.querySelector('#app').innerHTML=window.testView==='admin'?BXHCommerce.adminPage():window.testView==='orders'?BXHCommerce.orders():window.testView==='management'?(BXHCommerce.ticketCreationPage()||'<button data-action="commerce-open-ticket-create">＋ 新增賽事</button>'):BXHCommerce.shop();
   window.testProduct={id:'skin_test',version:1,name:'星空獵人 Skin（隔離測試）',description:'收藏外觀示範。這是隔離測試商品，沒有正式販售。',terms:'永久持有；測試商品說明。',priceTwd:100,imageUrl:'https://example.invalid/skin.svg',audience:'all',sort:0,status:'published',purchasable:true,delivery:{kind:'skin',assetId:'test_skin',quantity:1,durationDays:0}};
   window.ticketOffer={...testProduct,id:'activation_ticket_32',version:4,name:'賽事啟動券｜32 人',priceTwd:300,audience:'partner_organizer',delivery:{kind:'ticket',assetId:'32',quantity:1,durationDays:30}};
   window.testOrders=[];window.testCalls=[];
   window.engagementService={commerce:async p=>{
    testCalls.push(p);
    if(p.action==='catalog')return {ok:true,products:window.testUid==='ticket_buyer'?[ticketOffer]:[testProduct,ticketOffer],nextCursor:null,storeOpen:true};
    if(p.action==='admin-products')return {ok:true,products:[testProduct],nextCursor:null};
    if(['my-orders','admin-orders'].includes(p.action))return {ok:true,orders:testOrders,nextCursor:null};
    if(p.action==='my-tickets')return {ok:true,tickets:window.testUid==='ticket_buyer'?[{
     id:'fixture-ticket',capacity:32,status:window.BXH_TICKET_ROOM_PILOT_CODE&&!testTicketRoom?'available':'reserved',issuedAt:Date.now(),expiresAt:Date.now()+86400000,boundRoomCode:window.BXH_TICKET_ROOM_PILOT_CODE&&!testTicketRoom?null:'BXH-TICKETTEST'
    }]:[]};
    if(p.action==='admin-config')return {ok:true,config:null,capabilities:{}};
    if(p.action==='admin-config-save')return {ok:true,config:{...p,version:1}};
    if(p.action==='admin-product-save')return {ok:true,product:{...p.product,id:p.productId,version:1}};
    if(p.action==='create-order'){
     const product=p.productId===ticketOffer.id?ticketOffer:testProduct;
     if(p.expectedVersion!==product.version)throw Error('product-changed');
     const order={id:product===ticketOffer?'BXH-SO-TEST002':'BXH-SO-TEST001',ownerUid:currentAuthUid(),buyerName:'測試玩家',createdAt:Date.now(),expiresAt:Date.now()+86400000,amountTwd:product.priceTwd,productSnapshot:product,paymentStatus:'pending',deliveryStatus:'not_started',bankSnapshot:{bankCode:'999',bankName:'隔離測試銀行',branch:'測試分行',accountName:'測試戶',accountNumber:'0000000000'}};
     testOrders.push(order);return {ok:true,order};
    }
    const order=testOrders.find(o=>o.id===p.orderId);
    if(p.action==='order-detail')return {ok:true,order};
    if(p.action==='report-payment'){order.report=p.report;order.paymentStatus='reported';return {ok:true,order};}
    if(p.action==='admin-confirm-payment'){order.paymentStatus='paid';order.deliveryStatus='delivered';order.paidAt=Date.now();order.deliveredAt=Date.now();return {ok:true,order};}
    throw Error('unsupported-test-action');
   }};
   window.testTicketRoom=null;
   window.engagementService.ticketRoomOperation=async p=>{
    testCalls.push(p);
    if(p.action==='ticket-ptn-status')return {ok:true,code:testTicketRoom?.code??null};
    if(p.action==='create-ticket-room'){
     testTicketRoom={ok:true,code:p.code??'PTN-TEST32',roomId:'fixture-room-generation',name:p.name,phase:'waiting',ticketStatus:'reserved',
      startAt:p.startAt,drawId:null,rosterRevision:7,eligibleCount:2};
     return {ok:true,code:testTicketRoom.code,roomId:testTicketRoom.roomId};
    }
    if(p.code!==testTicketRoom?.code)throw Error('invalid-operation');
    if(p.action==='ticket-room-state')return {...testTicketRoom};
    if(p.roomId!==testTicketRoom.roomId||p.rosterRevision!==7)throw Error('invalid-operation');
    if(p.action==='ticket-room-draw'){testTicketRoom.drawId='fixture-draw';return {ok:true,drawId:testTicketRoom.drawId};}
    if(p.action==='ticket-room-start'&&p.drawId===testTicketRoom.drawId){testTicketRoom.phase='live';testTicketRoom.ticketStatus='consumed';return {ok:true,startedAt:Date.now()};}
    throw Error('unsupported-ticket-room-action');
   };
   document.addEventListener('click',e=>{const t=e.target.closest('[data-action^="commerce-"]');if(t){e.preventDefault();void BXHCommerce.handle(t.dataset.action,t);}});
  });
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'commerce-ui.js'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'modules/main-app/domain-utils.js'),'utf8')});
  await page.evaluate(()=>{window.snapToHalfHourValue=window.BXHDomainUtils.snapToHalfHourValue;});
  await page.addScriptTag({content:timeGuard});await page.evaluate(()=>render());
  assert.equal(await page.locator('[data-action="commerce-category"][data-id="ticket"]').count(),0);
  await page.locator('[data-action="commerce-category"][data-id="all"]').click();
  await page.getByText('星空獵人 Skin（隔離測試）',{exact:true}).waitFor();
  assert.equal(await page.getByText('賽事啟動券｜32 人',{exact:true}).count(),0);
  await page.locator('[data-action="commerce-categories"]').click();
  await page.locator('[data-action="commerce-category"][data-id="skin"]').click();
  await page.locator('[data-action="commerce-product"]').click();
  await page.locator('[data-commerce-consent]').check();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.COMMERCE_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.COMMERCE_SCREENSHOT_DIR,`commerce-product-${width}.png`),fullPage:true});
  await page.locator('[data-action="commerce-buy"]').click();
  await page.locator('[name="lastFive"]').fill('12345');await page.locator('[name="transferredAt"]').fill('2026-10-28T14:37');
  await page.locator('[name="note"]').fill('測試回報');
  assert.equal(await page.locator('[name="transferredAt"]').inputValue(),'2026-10-28T14:37');
  assert.equal(await page.evaluate(()=>{const i=document.createElement('input');i.type='time';i.value='14:37';i.hidden=true;document.body.append(i);i.dispatchEvent(new Event('change',{bubbles:true}));const v=i.value;i.remove();return v;}),'14:30');
  await page.evaluate(()=>render());assert.equal(await page.locator('[name="lastFive"]').inputValue(),'12345');
  await page.locator('[data-commerce-form="report"] button:not([type="button"])').click();
  await page.getByText('匯款資料已送出，等待 BXH 核對。').waitFor();
  assert.equal(await page.evaluate(()=>testCalls.find(p=>p.action==='report-payment').report.transferredAt),Date.parse('2026-10-28T14:37:00+08:00'));
  await page.evaluate(()=>{testView='orders';render();});await page.locator('[data-action="commerce-order"]').click();
  await page.getByText('訂單詳情',{exact:true}).waitFor();
  await page.evaluate(()=>{testView='admin';testAdmin=true;activeTab='commerce-admin';render();});
  await page.locator('[data-action="commerce-order"]').click();
  await page.locator('[name="receivedAmountTwd"]').fill('100');await page.locator('[name="paymentReference"]').fill('BANK-TEST-001');
  await page.locator('[data-commerce-form="confirm"] button').click();await page.getByText('已交付',{exact:true}).waitFor();
  await page.locator('[data-action="commerce-back-orders"]').click();await page.locator('[data-action="commerce-admin-zone"][data-id="config"]').click();
  await page.locator('[name="bankCode"]').fill('999');await page.locator('[name="bankName"]').fill('隔離測試銀行');await page.locator('[name="branch"]').fill('測試分行');await page.locator('[name="accountName"]').fill('測試戶');await page.locator('[name="accountNumber"]').fill('0000000000');
  await page.locator('[data-commerce-form="config"] button').click();
  await page.getByText('操作已確認完成。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.COMMERCE_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.COMMERCE_SCREENSHOT_DIR,`commerce-admin-${width}.png`),fullPage:true});
  await page.locator('[data-action="commerce-admin-zone"][data-id="products"]').click();
  await page.locator('[data-action="commerce-edit-product"]').waitFor();
  await page.locator('[data-action="commerce-new-product"]').click();
  await page.locator('[name="name"]').fill('測試外觀草稿');await page.locator('[name="description"]').fill('隔離測試說明');await page.locator('[name="imageUrl"]').fill('https://example.invalid/test.webp');await page.locator('[name="assetId"]').fill('skin_draft');await page.locator('[name="terms"]').fill('測試商品條款');
  await page.locator('[data-commerce-form="product"] button').first().click();
  await page.getByText('操作已確認完成。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>testCalls.filter(p=>p.action==='admin-product-save').at(-1).product.name),'測試外觀草稿');
  await page.evaluate(()=>{testUid='another_account';engagementSessionEpoch++;testAdmin=false;testView='orders';render();});
  assert.equal(await page.evaluate(()=>BXHCommerce.context().pending),null);
  await page.evaluate(()=>{testUid='ticket_buyer';engagementSessionEpoch++;testView='shop';render();});
  await page.locator('[data-action="commerce-category"][data-id="ticket"]').click();
  await page.locator('[data-action="commerce-open-tickets"]').click();
  await page.getByText('已綁定房間 BXH-TICKETTEST',{exact:true}).waitFor();
  await page.getByText('到期時間（台灣時間）',{exact:false}).waitFor();
  assert.equal(await page.locator('[data-action="commerce-ticket-bind"]').count(),0);
  await page.evaluate(ptn=>{window.BXH_TICKET_ROOM_PILOT_CODE='BXH-TICKETTEST';window.BXH_TICKET_ROOM_PTN_PILOT=ptn;activeTab='management';testView='management';render();},ptn);
  await page.getByRole('button',{name:'＋ 新增賽事'}).click();
  await page.getByRole('heading',{name:'新增賽事｜選券建房'}).waitFor();
  const ticketOptions=page.locator('[data-action="commerce-ticket-bind"]');
  await ticketOptions.filter({hasText:'可用 1 張'}).waitFor();
  assert.equal(await ticketOptions.count(),5);
  assert.equal(await page.locator('[data-action="commerce-ticket-bind"][disabled]').count(),4);
  await ticketOptions.filter({hasText:'可用 1 張'}).click();
  await page.locator('[name="name"]').fill('票券試點賽事');
  await page.locator('[name="location"]').fill('台南');
  await page.locator('[name="registrationOpenAt"]').fill('2026-12-19T12:00');
  await page.locator('[name="registrationCloseAt"]').fill('2026-12-19T13:00');
  await page.locator('[name="startAt"]').fill('2026-12-19T14:00');
  await page.getByRole('button',{name:'建立房間並綁券'}).click();
  await page.getByRole('heading',{name:'票券試點賽事'}).waitFor();
  await page.getByText('已綁定啟動券，開賽時扣用。',{exact:true}).waitFor();
  await page.locator('[data-action="commerce-ticket-draw"]').click();
  await page.getByText('可出賽 2 人｜已抽籤',{exact:true}).waitFor();
  await page.locator('[data-action="commerce-ticket-start"]').click();
  await page.getByText(expectedCode+'｜已開賽',{exact:true}).waitFor();
  await page.getByText('已扣用 1 張啟動券',{exact:true}).waitFor();
  const flow=await page.evaluate(()=>testCalls.filter(p=>['create-ticket-room','ticket-room-draw','ticket-room-start'].includes(p.action)));
  assert.deepEqual(flow.map(p=>p.action),['create-ticket-room','ticket-room-draw','ticket-room-start']);
  assert.equal(flow[0].code,ptn?undefined:expectedCode);
  assert.ok(flow.slice(1).every(p=>p.code===expectedCode));
  assert.equal(flow[0].startAt,Date.parse('2026-12-19T14:00:00+08:00'));
  assert.equal(flow[2].drawId,'fixture-draw');
  assert.ok(flow.every(p=>p.operationId));
  await page.locator('[data-action="commerce-ticket-back"]').click();
  await page.getByRole('button',{name:'管理已建立的賽事'}).waitFor();
  await page.locator('[data-action="commerce-close-ticket-create"]').click();
  await page.getByRole('button',{name:'＋ 新增賽事'}).waitFor();
  await page.evaluate(()=>{activeTab='commerce-shop';testView='shop';render();});
  await page.locator('[data-action="commerce-product"][data-id="tournament_activation_32"]').click();
  await page.getByText('同時最多持有 2 張，每月五款合計限購 4 張。').waitFor();
  await page.locator('[data-commerce-consent]').check();
  await page.locator('[data-action="commerce-buy"]').click();
  await page.getByText('BXH-SO-TEST002',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>testCalls.filter(p=>p.action==='create-order').at(-1).productId),'activation_ticket_32');
  assert.deepEqual(errors,[]);console.log(`PASS ${width}px catalog/detail/order/report/admin-confirm/config/session isolation/ticket checkout and lifecycle`);await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
