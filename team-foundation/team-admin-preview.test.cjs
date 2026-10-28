'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,view}=require('./team-admin-preview.js');
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
