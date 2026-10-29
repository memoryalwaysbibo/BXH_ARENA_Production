'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,view}=require('./team-admin-preview.js');
const vm=require('node:vm'),fs=require('node:fs');
function entry(enabled,read){
 let renders=0,calls=0,selected=null;const nodes=[];
 const ctx={structuredClone,window:{BXH_TEAM_ADMIN_PREVIEW:enabled,engagementService:{tournamentOperation:async(...args)=>{calls++;return read?read(...args):{items:[],total:0};}}},userProfile:{role:'super_admin',active:true},currentAuthUid:()=> 'admin',render:()=>renders++,document:{querySelector:()=>selected}};
 const original=ctx.render;vm.runInNewContext(fs.readFileSync(__dirname+'/team-admin-preview.js','utf8'),ctx);
 return {ctx,nodes,original,preview:ctx.window.BXHTeamAdminPreview,
  mount(){selected={innerHTML:'',events:{},addEventListener(t,f){this.events[t]=f;},contains:()=>true};nodes.push(selected);return selected;},
  leave(){selected=null;},get renders(){return renders;},get calls(){return calls;}};
}
test('disabled entry leaves the renderer untouched and makes no requests',()=>{
 const f=entry(false);f.mount();f.preview.bind();assert.equal(f.ctx.render,f.original);f.ctx.render();assert.equal(f.renders,1);assert.equal(f.calls,0);assert.equal(f.preview.visible(),false);assert.equal(f.preview.page(),'');
});
test('enabled preview reads only on its selected page and clears on downgrade',async()=>{
 const f=entry(true);f.preview.bind();assert.equal(f.calls,0);assert.equal(f.ctx.render,f.original);
 assert.match(f.preview.page(),/data-team-admin-preview-page/);assert.doesNotMatch(f.preview.page(),/position:fixed|<aside/);
 const page=f.mount();f.preview.bind();await new Promise(setImmediate);assert.equal(f.calls,1);assert.match(page.innerHTML,/目前沒有/);
 f.ctx.render();f.preview.bind();assert.equal(f.renders,1);assert.equal(f.calls,1);
 f.ctx.userProfile.role='admin';f.preview.bind();assert.equal(page.innerHTML,'');assert.equal(f.calls,1);assert.equal(f.preview.page(),'');
});
test('logging out clears the page and late requests cannot restore its content',async()=>{
 let resolve;const f=entry(true,()=>new Promise(r=>resolve=r)),page=f.mount();f.preview.bind();
 f.ctx.currentAuthUid=()=>null;f.preview.bind();resolve({items:[{id:'secret',name:'previous account'}],total:1});
 await new Promise(setImmediate);assert.equal(page.innerHTML,'');
});
test('main-page rerenders reuse the current request and state; leaving disposes it',async()=>{
 let resolve;const f=entry(true,()=>new Promise(r=>resolve=r));f.mount();f.preview.bind();
 const current=f.mount();f.preview.bind();assert.equal(f.calls,1);resolve({items:[{id:'bxh',name:'BXH',strength:10}],total:1});
 await new Promise(setImmediate);assert.match(current.innerHTML,/BXH/);
 f.leave();f.preview.bind();assert.equal(current.innerHTML,'');
 const next=f.mount();f.preview.bind();assert.equal(f.calls,2);assert.doesNotMatch(next.innerHTML,/戰力 10/);
});
test('switching accounts recreates the page without old results',async()=>{
 let resolve;const f=entry(true,()=>new Promise(r=>resolve=r)),page=f.mount();f.preview.bind();const old=resolve;
 f.ctx.currentAuthUid=()=> 'second';f.preview.bind();assert.equal(f.calls,2);old({items:[{name:'old account'}],total:1});
 await new Promise(setImmediate);assert.doesNotMatch(page.innerHTML,/old account/);
 resolve({items:[],total:0});await new Promise(setImmediate);assert.match(page.innerHTML,/目前沒有/);
});
test('preview refuses non-super-admin identities without requesting data',async()=>{
 for(const p of [null,{uid:'u',role:'admin',active:true},{uid:'u',role:'super_admin',active:false},{uid:'u',role:'super_admin',active:true,isTestAccount:true}]){
  let calls=0;const c=create({getIdentity:()=>p,read:async()=>{calls++;}});await c.load('list');assert.equal(calls,0);
 }
});
test('late responses cannot cross logout or account changes',async()=>{
 let p={uid:'a',role:'super_admin',active:true},resolve;
 const c=create({getIdentity:()=>p,read:()=>new Promise(r=>resolve=r)});
 const pending=c.load('list');p={...p,uid:'b'};resolve({items:[{name:'old account'}]});await pending;assert.equal(c.snapshot().result,null);
});
test('preview only permits read operations, escapes names and offers no mutation controls',async()=>{
 const calls=[],c=create({getIdentity:()=>({uid:'a',role:'super_admin',active:true}),read:async p=>(calls.push(p),{items:[{id:'a',name:'<script>',strength:12}],total:21})});
 assert.equal((await c.load('approve')).ok,false);await c.load('list',{query:'隊',offset:0});assert.equal(calls.length,1);assert.equal(calls[0].action,'list');
 const html=view(c.snapshot());assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/data-preview="next"/);assert.doesNotMatch(html,/data-team-action=|data-preview="(?:approve|join|create|upload)"/);
});

test('player primary tabs expose teams only through the current preview authorization',()=>{
 const core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
 const fn=core.slice(core.indexOf('function playerVisibleTabs(){'),core.indexOf('\n\nlet engagementSnapshot='));
 for(const enabled of [false,true]){
  const f=entry(enabled),ctx={window:f.ctx.window,PLAYER_TABS:[['home','賽事大廳'],['shop','商城']],hunterClashEntry:{visible:()=>true}};
  vm.runInNewContext(fn+'; result=playerVisibleTabs();',ctx);
  assert.equal(ctx.result.some(t=>t[0]==='team-preview'),enabled);if(enabled)assert.equal(ctx.result.findIndex(t=>t[0]==='team-preview')+1,ctx.result.findIndex(t=>t[0]==='shop'));assert.equal(ctx.result.some(t=>t[0]==='clash'),true);
  f.ctx.userProfile.role='player';vm.runInNewContext('result=playerVisibleTabs()',ctx);assert.equal(ctx.result.some(t=>t[0]==='team-preview'),false);
 }
});
test('management V2 puts teams in its primary rail only when the canonical manifest allows it',()=>{
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/management-v2/navigation.js','utf8'),ctx);
 const nav=ctx.window.BXH_MANAGEMENT_UI_V2,base=['management','live','ladder','history'];
 assert.equal(nav.visibleGroups(base).some(g=>g.id==='team'),false);
 const permitted=[...base,'team-preview'];assert.equal(nav.groupForTab('team-preview').id,'team');
 assert.match(nav.renderRails('team-preview',permitted),/data-management-v2-group="team" class="active"/);
 assert.equal(nav.firstVisibleTab('team',permitted),'team-preview');
 assert.equal(fs.readFileSync(__dirname+'/../management-ui-v2.js','utf8'),fs.readFileSync(__dirname+'/../modules/management-v2/navigation.js','utf8'));
});
