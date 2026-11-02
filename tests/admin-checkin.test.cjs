'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../modules/main-app/admin-checkin.js');
function fixture(){
 const store=new Map();let permitted=true,current=true,calls=0,adopted=0,fail=false,readable=true,mirrorStale=false;
 let server={id:'r',players:[{id:'p',name:'甲',checkedIn:false}],adminOperationOverrides:[]};
 const ctx={key:'u:r',actorUid:'u',roomId:'r',code:'BXH-TEST01',storage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  current:()=>current,allowed:()=>permitted,operationId:()=> '12345678-12345678',now:()=>1000,wait:async()=>{},
  call:async d=>{calls++;if(!server.adminOperationOverrides.some(r=>r.id===d.operationId)){
   server.players[0].checkedIn=d.checkedIn;server.adminOperationOverrides.push({id:d.operationId,actorUid:'u',playerId:'p',checkedIn:d.checkedIn});}
   if(fail)throw Error('lost-ack');return {ok:true};},
  read:async()=>readable?{ok:true,data:structuredClone(server),publicData:{players:[{...server.players[0],checkedIn:mirrorStale?!server.players[0].checkedIn:server.players[0].checkedIn}]}}:{ok:false},
  adopt:async()=>{adopted++;}};
 return {ctx,controller:create(ctx),server,store,stats:()=>({calls,adopted}),deny:()=>permitted=false,leave:()=>current=false,loseAck:()=>{fail=true;readable=false;},restore:()=>{readable=true;fail=false;},staleMirror:()=>mirrorStale=true};
}
test('opening confirmation has no writes; execute waits for audit and both mirrors',async()=>{const f=fixture(),a=f.controller.prepare(f.server.players[0],'現場確認');assert.equal(f.stats().calls,0);assert.equal(f.store.size,0);const r=await f.controller.execute(a);assert.equal(r.ok,true);assert.equal(f.stats().adopted,1);assert.equal(f.store.size,0);});
test('unknown result survives reload and reuses ID; later revoke is not undone',async()=>{const f=fixture();f.loseAck();await assert.rejects(f.controller.execute(f.controller.prepare(f.server.players[0],'確認')),/lost-ack/);assert.equal(f.store.size,1);f.server.players[0].checkedIn=false;f.restore();const reloaded=create(f.ctx),a=reloaded.prepare(f.server.players[0],'new reason ignored');assert.equal(a.data.checkedIn,true);assert.equal(a.data.operationId,'12345678-12345678');const r=await reloaded.execute(a);assert.equal(r.superseded,true);assert.equal(f.server.players[0].checkedIn,false);assert.equal(f.server.adminOperationOverrides.length,1);assert.equal(f.store.size,0);});
test('stale public readback cannot produce success',async()=>{const f=fixture();f.staleMirror();await assert.rejects(f.controller.execute(f.controller.prepare(f.server.players[0],'核對')),/cloud-readback-unconfirmed/);assert.equal(f.stats().adopted,0);assert.ok(f.controller.status().pending);});
test('role revoked after opening confirmation cannot execute',async()=>{const f=fixture(),a=f.controller.prepare(f.server.players[0],'核對');f.deny();await assert.rejects(f.controller.execute(a),/unavailable/);assert.equal(f.stats().calls,0);});
test('room switch during response cannot adopt or clear pending',async()=>{const f=fixture();f.ctx.call=async()=>{f.leave();return {ok:true};};await assert.rejects(f.controller.execute(f.controller.prepare(f.server.players[0],'核對')),/context/);assert.equal(f.stats().adopted,0);assert.equal(f.store.size,1);});
test('durable storage required before sending',async()=>{const f=fixture();f.ctx.storage.setItem=()=>{throw Error('storage-full');};await assert.rejects(f.controller.execute(f.controller.prepare(f.server.players[0],'核對')),/storage-full/);assert.equal(f.stats().calls,0);});
test('corrupt pending storage cannot create a second operation',()=>{const f=fixture();f.ctx.storage.getItem=()=>'{bad';const c=create(f.ctx);assert.equal(c.status().corrupt,true);assert.throws(()=>c.prepare(f.server.players[0],'核對'),/unavailable/);});
test('explicit rejected transaction clears pending only after authoritative absence',async()=>{const f=fixture();f.ctx.call=async()=>{throw Object.assign(Error('attendance-changed'),{code:'functions/failed-precondition'});};await assert.rejects(f.controller.execute(f.controller.prepare(f.server.players[0],'核對')),/attendance-changed/);assert.equal(f.store.size,0);assert.equal(f.stats().adopted,0);});
