'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,view}=require('./team-admin-preview.js');
const vm=require('node:vm'),fs=require('node:fs');
function entry(enabled){
 let renders=0,calls=0;const nodes=[];
 const ctx={structuredClone,window:{BXH_TEAM_ADMIN_PREVIEW:enabled,engagementService:{tournamentOperation:async()=>{calls++;return {items:[],total:0};}}},userProfile:{role:'super_admin',active:true},currentAuthUid:()=> 'admin',render:()=>renders++,document:{body:{append:n=>nodes.push(n)},createElement:()=>({innerHTML:'',style:{},setAttribute(){},addEventListener(){},remove(){this.removed=true;}})}};
 const original=ctx.render;vm.runInNewContext(fs.readFileSync(__dirname+'/team-admin-preview.js','utf8'),ctx);
 return {ctx,nodes,original,get renders(){return renders;},get calls(){return calls;}};
}
test('disabled entry leaves the existing renderer untouched and makes no requests',()=>{
 const f=entry(false);assert.equal(f.ctx.render,f.original);f.ctx.render();assert.equal(f.renders,1);assert.equal(f.calls,0);assert.equal(f.nodes.length,0);
});
test('enabled entry preserves rendering and removes its panel after downgrade',async()=>{
 const f=entry(true);await new Promise(setImmediate);assert.equal(f.calls,1);assert.equal(f.nodes.length,1);
 f.ctx.render();assert.equal(f.renders,1);assert.equal(f.calls,1);
 f.ctx.userProfile.role='admin';f.ctx.render();assert.equal(f.renders,2);assert.equal(f.nodes[0].removed,true);assert.equal(f.calls,1);
});
test('logging out clears the entry and late requests cannot restore its content',async()=>{
 const f=entry(true);f.ctx.currentAuthUid=()=>null;f.ctx.render();const html=f.nodes[0].innerHTML;
 await new Promise(setImmediate);assert.equal(f.nodes[0].removed,true);assert.equal(f.nodes[0].innerHTML,html);
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
