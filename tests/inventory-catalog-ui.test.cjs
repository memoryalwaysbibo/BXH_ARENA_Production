'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','inventory-catalog-ui.js'),'utf8');
function setup(admin=true){
 const sandbox={window:{},document:{addEventListener(){}},currentAuthUid:()=>admin?'admin':'player',engagementSessionEpoch:1,isSuperAdmin:()=>admin,
 sessionStorage:{getItem:()=>null},setTimeout(){},esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),
 render(){},catalogStages:{},inventoryExpiry(){},titleRecipientLabel:x=>x.name};
 vm.createContext(sandbox);vm.runInContext(src,sandbox);return sandbox;
}
test('only super-admin sees management zones and unpublished drafts cannot be gifted',()=>{
 const s=setup(true),c=s.catalogState();
 c.items=[{id:'draft-12345678',status:'draft',origin:'codex',name:'未發佈',stage:'ready',type:'general',description:'草稿'}, {id:'published-12345678',status:'published',code:'A001',name:'抽獎券',type:'general',description:'正式券'}];
 c.legacy=[{id:'userItems/player/lots/abc',itemCode:'ITEM-000001',name:'既有券',purpose:'用途',ownerUid:'player',quantity:2}];
 let view=s.renderInventoryCatalogAdmin();
 assert.match(view,/A001/);assert.match(view,/既有券/);assert.match(view,/取資料至製作區/);assert.doesNotMatch(view,/未發佈/);
 c.zone='craft';view=s.renderInventoryCatalogAdmin();assert.match(view,/Codex 草稿箱/);assert.match(view,/未發佈/);assert.match(view,/發布到道具區/);
 c.zone='gifts';view=s.renderInventoryCatalogAdmin();assert.match(view,/A001 抽獎券/);assert.doesNotMatch(view,/未發佈/);
 assert.doesNotMatch(setup(false).renderInventoryCatalogAdmin(),/道具管理分區/);
});
