'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createTeamHost}=require('./team-host.js');
test('disabled or signed-out host never opens team APIs',()=>{
 let enabled=false,signedIn=false,apiCalls=0,mounts=0;const container={replaceChildren(){}};
 const host=createTeamHost({container,isEnabled:()=>enabled,getIdentity:()=>signedIn?'user':null,apiFactory:()=>{apiCalls++;return {};},component:{mount:()=>{mounts++;return {destroy(){}};}}});
 assert.equal(host.open().reason,'disabled');enabled=true;assert.equal(host.open().reason,'sign-in-required');assert.equal(apiCalls,0);assert.equal(mounts,0);
});
test('host mounts once and destroys mounted team state on sign-out',()=>{
 let signedIn=true,mounts=0,destroys=0;const container={replaceChildren(){}};
 const host=createTeamHost({container,isEnabled:()=>true,getIdentity:()=>signedIn?'user':null,apiFactory:()=>({}),component:{mount:()=>{mounts++;return {destroy(){destroys++;}};}}});
 assert.equal(host.open().ok,true);assert.equal(host.open().alreadyOpen,true);assert.equal(mounts,1);signedIn=false;host.sync();assert.equal(destroys,1);assert.equal(host.open().reason,'sign-in-required');
});
test('host fails closed if mounting fails',()=>{
 let clears=0;const host=createTeamHost({container:{replaceChildren(){clears++;}},isEnabled:()=>true,getIdentity:()=>'user',apiFactory:()=>{throw Error('private');},component:{mount(){}}});
 assert.deepEqual(host.open(),{ok:false,reason:'unavailable'});assert.equal(clears,1);
});

test('switching signed-in accounts disposes the previous team state',()=>{
 let uid='a',destroys=0,mounts=0;const host=createTeamHost({container:{replaceChildren(){}},isEnabled:()=>true,getIdentity:()=>uid,apiFactory:()=>({}),component:{mount:()=>{mounts++;return {destroy(){destroys++;}};}}});
 host.open();uid='b';host.sync();assert.equal(destroys,1);host.open();assert.equal(mounts,2);
});
