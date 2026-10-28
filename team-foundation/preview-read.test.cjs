'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPreviewReadHandler}=require('./preview-read.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
function setup({enabled=true,profile={role:'super_admin',active:true},account={}}={}){
 let transactions=0,profileReads=0,authReads=0;
 const state={profile};
 const db={doc:path=>({path,get:async()=>{profileReads++;assert.equal(path,'users/real');return {exists:!!state.profile,data:()=>state.profile};}}),runTransaction:async fn=>{transactions++;return fn({get:async()=>({exists:false})});}};
 const handler=createPreviewReadHandler({db,auth:{getUser:async()=>{authReads++;return account;}},HttpsError,enabled});
 return {handler,state,get counts(){return {transactions,profileReads,authReads};}};
}
const request=()=>({app:{appId:'verified'},auth:{uid:'real',token:{auth_time:200}},data:{action:'mine'}});
test('preview defaults off and missing App Check or Auth cannot read roles',async()=>{
 const f=setup({enabled:false});await assert.rejects(f.handler(request()),/preview-unavailable/);assert.deepEqual(f.counts,{transactions:0,profileReads:0,authReads:0});
 for(const key of ['app','auth']){const f=setup(),r=request();delete r[key];await assert.rejects(f.handler(r));assert.equal(f.counts.profileReads,0);}
});
test('only active canonical super admins enter preview; client claims never authorize',async()=>{
 for(const profile of [null,{role:'admin',active:true},{role:'staff',active:true},{role:'player',active:true},{role:'super_admin',active:false},{role:'super_admin'},{role:'super_admin',active:true,isTestAccount:true}]){
  const f=setup({profile}),r=request();r.auth.token.role='super_admin';await assert.rejects(f.handler(r),/preview-denied/);assert.equal(f.counts.transactions,0);
 }
});
test('super admin preview reads without mutations and role revocation applies next request',async()=>{
 const f=setup();assert.equal((await f.handler(request())).team,null);assert.equal(f.counts.transactions,1);
 f.state.profile.role='admin';await assert.rejects(f.handler(request()),/preview-denied/);assert.equal(f.counts.transactions,1);
});
test('disabled or revoked accounts fail before profile lookup',async()=>{
 for(const account of [{disabled:true},{tokensValidAfterTime:new Date(201000).toISOString()}]){const f=setup({account});await assert.rejects(f.handler(request()));assert.equal(f.counts.profileReads,0);}
});
test('preview rejects writes and forged actor fields; ordinary read allowlist still applies',async()=>{
 for(const action of ['create','apply','approve','emblem','history','reason']){const f=setup(),r=request();r.data.action=action;await assert.rejects(f.handler(r),/invalid-preview-read/);assert.equal(f.counts.transactions,0);}
 const f=setup(),r=request();r.data.actorUid='other';await assert.rejects(f.handler(r),/unexpected-read-field/);assert.equal(f.counts.transactions,0);
});
