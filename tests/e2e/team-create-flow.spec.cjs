'use strict';
const {test,expect}=require('@playwright/test');
// Shipped application, menus and page module; only identity/cloud services are
// synthetic. This never contacts Firebase or changes production team data.
test.use({serviceWorkers:'block',contextOptions:{reducedMotion:'reduce'}});
async function open(page,mode='admin',ui='v2'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  // WebKit routes local object URLs too; keep image decoding inside this fixture.
  if(u.protocol==='blob:'&&['localhost','127.0.0.1'].includes(new URL(u.origin).hostname))return route.continue();
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort('blockedbyclient');
  if(u.pathname==='/modules/cloud/cloud-runtime.js')return route.fulfill({contentType:'text/javascript',body:'// Isolated team preview services.'});
  return route.continue();
 });
 await page.addInitScript(({ui})=>{
  localStorage.setItem('bxh:management-interface',ui);
  window.teamFixture={calls:[],ready:false,created:null,capacity:'open',rows:[]};
  window.cloudSync={isEnabled:()=>true,connect:async()=>true,
   subscribePublicTournaments:()=>()=>{},queryPublicTournaments:async()=>({ok:true,items:[],fromCache:false,hasPendingWrites:false}),queryMyRegistrations:async()=>[],queryAdminTournaments:async()=>[]};
  window.cloudAuth={isReady:()=>true,hasSuperAdmin:async()=>true,onAuthChange:()=>{teamFixture.ready=true;return ()=>{};},touchLastLogin:()=>{},signOutUser:async()=>{}};
  window.engagementService={mailbox:async()=>({ok:true,messages:[],unreadCount:0}),mood:async()=>({ok:true,messages:[]}),courtCall:async()=>({ok:true,rows:[],prepares:[]}),familyRegistration:async()=>({ok:true,rows:[]}),
   tournamentOperation:async(name,p)=>{
    teamFixture.calls.push({name,p});
    if(name==='teamRead'&&p.action==='list')return {items:teamFixture.rows,total:teamFixture.rows.length};
    if(name==='teamEmblemUpload')return {ok:true};
    if(name==='teamRead'&&p.action==='emblem')return {image:null};
    if(name==='teamRead'&&p.action==='mine')return {team:teamFixture.created,creationCapacity:{status:teamFixture.capacity,activeCount:0,limit:200}};
    if(name==='teamCommand'&&p.action==='create'){teamFixture.created={id:p.teamId,name:p.name,role:'captain',memberCount:1,level:1,capacity:10,totalXp:0,unlockedFrames:[]};return {ok:true};}
    throw Error('Unexpected test request '+name+':'+p.action);
   }};
 },{ui});
 await page.goto('/',{waitUntil:'load'});expect(await page.evaluate(()=>window.BXH_TEAM_FULL_ENABLED)).toBe(true);await page.waitForFunction(()=>window.teamFixture?.ready&&window.BXHTeamFull);
 await page.evaluate(mode=>{
  firebaseUser={uid:'fixture-admin',email:'team@example.invalid'};
  userProfile={role:'super_admin',active:true,realName:'測試管理員',displayName:'測試管理員',email:'team@example.invalid'};
  currentRole=mode==='admin'?'admin':'player';appPhase=mode==='admin'?'app':'player-center';
  activeTab='version';playerActiveTab='home';render();
 },mode);
 return errors;
}

test('create flow reads capacity, submits once, then shows the new captain team',async({page})=>{
 const errors=await open(page);await page.locator('[data-management-v2-group="team"]').click();
 await page.getByRole('button',{name:'建立戰隊',exact:true}).click();
 const form=page.locator('[data-team-form="create"]');await expect(form).toBeVisible();
 await form.locator('[name="name"]').fill('BXH 測試戰隊');await form.getByRole('button',{name:'建立戰隊',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我的戰隊',exact:true})).toBeVisible();
 await expect(page.locator('#bxh-team-full-slot')).toContainText('BXH 測試戰隊');
 const writes=await page.evaluate(()=>teamFixture.calls.filter(c=>c.name==='teamCommand'));
 expect(writes).toHaveLength(1);expect(writes[0].p.action).toBe('create');expect(writes[0].p.requestId).toBeTruthy();expect(writes[0].p.actorUid).toBeUndefined();
 await page.evaluate(()=>render());await expect(page.locator('#bxh-team-full-slot')).toContainText('BXH 測試戰隊');
 expect(await page.evaluate(()=>teamFixture.calls.filter(c=>c.name==='teamCommand').length)).toBe(1);expect(errors).toEqual([]);
});
test('unknown capacity and existing membership do not offer a create form',async({page})=>{
 const errors=await open(page);await page.evaluate(()=>{teamFixture.capacity='unavailable';});
 await page.locator('[data-management-v2-group="team"]').click();await page.getByRole('button',{name:'建立戰隊',exact:true}).click();
 await expect(page.locator('[data-team-form="create"]')).toHaveCount(0);await expect(page.locator('#bxh-team-full-slot')).toContainText('戰隊名額暫時無法確認');
 await page.evaluate(()=>{teamFixture.created={id:'existing',name:'原戰隊',role:'member',memberCount:2};});
 await page.getByRole('button',{name:'重新整理名額'}).click();await expect(page.locator('[data-team-form="create"]')).toHaveCount(0);await expect(page.locator('#bxh-team-full-slot')).toContainText('已有所屬戰隊');expect(errors).toEqual([]);
});

// The native canvas PNG fallback mirrors Safari; cloud APIs remain synthetic.
test('custom JPEG creates a team and uploads bounded WebP when native encoding and bitmap decoding are unavailable',async({page})=>{
 const errors=await open(page);
 await page.evaluate(()=>{
  window.createImageBitmap=async()=>{throw Error('bitmap unavailable');};
  const native=HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob=function(cb){return native.call(this,cb,'image/png');};
 });
 await page.locator('[data-management-v2-group="team"]').click();
 await page.getByRole('button',{name:'建立戰隊',exact:true}).click();
 const form=page.locator('[data-team-form="create"]');
 await form.locator('[name="name"]').fill('BXH 圖片測試');
 await form.locator('[name="customEmblem"]').setInputFiles(process.env.BXH_TEAM_IMAGE_FIXTURE||require('node:path').join(__dirname,'fixtures/team-emblem.jpg'));
 await form.getByRole('button',{name:'建立戰隊',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>teamFixture.calls.filter(c=>c.name==='teamEmblemUpload').length)).toBe(1);
 const result=await page.evaluate(async()=>{
  const p=teamFixture.calls.find(c=>c.name==='teamEmblemUpload').p;
  const bytes=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:'image/webp'})),image=new Image();
  try{image.src=url;await image.decode();return {type:p.contentType,size:bytes.length,header:new TextDecoder().decode(bytes.slice(0,4)),format:new TextDecoder().decode(bytes.slice(8,12)),width:image.naturalWidth,height:image.naturalHeight};}finally{URL.revokeObjectURL(url);}
 });
 expect(result.type).toBe('image/webp');expect(result.size).toBeLessThanOrEqual(128*1024);
 expect(result.header).toBe('RIFF');expect(result.format).toBe('WEBP');expect(result.width).toBe(256);expect(result.height).toBe(256);
 await expect(page.getByRole('heading',{name:'我的戰隊',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
test('broken custom image does not create a team or accumulate duplicate errors',async({page})=>{
 await open(page);await page.locator('[data-management-v2-group="team"]').click();
 await page.getByRole('button',{name:'建立戰隊',exact:true}).click();
 const form=page.locator('[data-team-form="create"]');await form.locator('[name="name"]').fill('圖片失敗測試');
 await form.locator('[name="customEmblem"]').setInputFiles({name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not an image')});
 for(let i=0;i<2;i++){
  await form.getByRole('button',{name:'建立戰隊',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'自訂圖片無法處理'})).toHaveCount(1);
 }
 expect(await page.evaluate(()=>teamFixture.calls.filter(c=>c.name==='teamCommand').length)).toBe(0);
});

test('native custom image preparation produces a decodable square WebP',async({page})=>{
 await open(page);await page.locator('[data-management-v2-group="team"]').click();await page.getByRole('button',{name:'建立戰隊',exact:true}).click();
 const form=page.locator('[data-team-form="create"]');await form.locator('[name="customEmblem"]').setInputFiles(require('node:path').join(__dirname,'fixtures/team-emblem.jpg'));
 const result=await page.evaluate(async()=>{
  const blob=await BXHTeamEmblem.prepare(document.querySelector('[name="customEmblem"]').files[0]);
  const url=URL.createObjectURL(blob),image=new Image();try{image.src=url;await image.decode();return {type:blob.type,width:image.naturalWidth,height:image.naturalHeight};}finally{URL.revokeObjectURL(url);}
 });expect(result).toEqual({type:'image/webp',width:256,height:256});
});

test('team lobby stays readable on narrow phones and teams precede the shop in player menus',async({page},testInfo)=>{
 const errors=await open(page,'player');
 await page.evaluate(()=>{userProfile.role='player';render();teamFixture.rows=[{id:'bxh',name:'BXH',captainName:'黑爸',strength:511,memberCount:1,capacity:10,preset:{id:'shield',color:'#EC536E'},join:{label:'我的戰隊',action:'mine',disabled:false}},{id:'long',name:'這是一支用來檢查手機排版的很長戰隊名稱',captainName:'這是一位名字較長的隊長',strength:123456,memberCount:10,capacity:10,preset:{id:'star',color:'#EC536E'},join:{label:'已滿員',disabled:true}}];});
 const tabs=await page.evaluate(()=>playerVisibleTabs().map(t=>t[0]));expect(tabs.indexOf('team-preview')+1).toBe(tabs.indexOf('shop'));
 await page.locator('.player-shell [data-tab="team-preview"]').first().click();
 const list=page.locator('.team-lobby-list'),items=list.locator('.team-lobby-item');await expect(items).toHaveCount(2);
 const search=page.locator('[data-team-form="search"]');await expect(search.locator('[name="query"]')).toHaveValue('');
 await expect(search.locator('[name="mode"]')).not.toBeVisible();await expect(search.locator('[name="sort"]')).not.toBeVisible();
 await expect(items.first().getByRole('button',{name:'我的戰隊',exact:true})).not.toBeVisible();
 for(const width of [320,390,430,1280]){
  await page.setViewportSize({width,height:900});
  const bounds=await list.evaluate(t=>({width:t.getBoundingClientRect().width,parent:t.parentElement.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,summary:t.querySelector('summary').getBoundingClientRect().height,toolbar:document.querySelector('.team-search-bar').getBoundingClientRect().height,firstTop:t.querySelector('summary').getBoundingClientRect().top}));
  expect(bounds.width).toBeLessThanOrEqual(bounds.parent+1);expect(bounds.overflow).toBe(false);expect(bounds.toolbar).toBeLessThan(65);expect(bounds.firstTop).toBeLessThan(650);
  if(width===390)await page.screenshot({path:testInfo.outputPath('team-lobby-simple-390.png'),fullPage:true});
 }
 await items.first().locator('summary').click();await expect(items.first().getByText('黑爸',{exact:true})).toBeVisible();await expect(items.first().getByRole('button',{name:'我的戰隊',exact:true})).toBeVisible();
 await items.first().locator('summary').press('Enter');await expect(items.first().getByText('黑爸',{exact:true})).not.toBeVisible();
 await search.getByRole('button',{name:'設定',exact:true}).click();await expect(search.locator('[name="mode"]')).toBeVisible();
 await search.locator('[name="query"]').fill('BXH');await search.locator('[name="mode"]').selectOption('review');await search.getByRole('button',{name:'搜尋',exact:true}).click();
 await expect(search.locator('[name="query"]')).toHaveValue('BXH');await expect(search.locator('[name="mode"]')).toHaveValue('review');
 expect(await page.evaluate(()=>teamFixture.calls.filter(c=>c.name==='teamRead'&&c.p.action==='list').at(-1).p.query.query)).toBe('BXH');
 if(await search.locator('#team-search-settings').isHidden())await search.getByRole('button',{name:'設定',exact:true}).click();
 await search.getByRole('button',{name:'清除篩選',exact:true}).click();await expect(search.locator('[name="query"]')).toHaveValue('');
 await page.evaluate(()=>{window.BXH_TEAM_FULL_ENABLED=false;render();});await expect(page.locator('[data-tab="team-preview"]')).toHaveCount(0);expect(errors).toEqual([]);
});
