'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../commerce-ui.js'),'utf8');
function setup(){
 const storage=new Map(),calls=[],listeners={};let uid='buyer',epoch=1,admin=false,fail=false;
 const sandbox={window:{engagementService:{commerce:async p=>{calls.push(JSON.parse(JSON.stringify(p)));if(fail)throw Error('network-timeout');return {ok:true,order:{id:'ORDER_TEST'}};}}},currentAuthUid:()=>uid,get engagementSessionEpoch(){return epoch;},isSuperAdmin:()=>admin,render(){},setTimeout(){},URL,Date,crypto:{randomUUID:()=> 'same-operation'},confirm:()=>true,esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{addEventListener:(k,f)=>listeners[k]=f,querySelector:()=>({checked:true})}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 return {ui:sandbox.window.BXHCommerce,calls,storage,listeners,sandbox,setUid:v=>{uid=v;epoch++;},setAdmin:v=>admin=v,setFail:v=>fail=v};
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
