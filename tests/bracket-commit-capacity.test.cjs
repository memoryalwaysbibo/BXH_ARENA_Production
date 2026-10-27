'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../modules/main-app/bracket-commit.js'),{draw}=require('./helpers/rdw-production-draw.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function controller(candidate){let reads=0,writes=0,cached=0,applied=0,success=0;
 const original=draw({format:'single',count:8,stations:2}),prior=clone(original),storage=new Map();
 const ctx={key:'capacity-test',actorUid:'owner',current:()=>true,state:()=>original,cloud:()=>true,operationId:()=> 'new-draw',generate:()=>clone(candidate),storage:{getItem:k=>storage.get(k),setItem:(k,v)=>{cached++;storage.set(k,v);},removeItem:k=>storage.delete(k)},read:async()=>{reads++;return {ok:true,data:prior,publicData:prior};},write:async()=>{writes++;return false;},apply:()=>applied++,success:()=>success++,changed(){}};
 return {ctx,original,prior,storage,make:()=>api.create(ctx),counts:()=>({reads,writes,cached,applied,success})};
}
test('capacity uses UTF-8 bytes, handles CJK/emoji and preserves exact boundary',()=>{
 for(const text of ['中文😀','a'.repeat(api.MAX_PAYLOAD_BYTES),'界'.repeat(api.MAX_PAYLOAD_BYTES/3)])assert.equal(api.assertCapacity(text).bytes,Buffer.byteLength(text));
 for(const text of ['a'.repeat(api.MAX_PAYLOAD_BYTES+1),'界'.repeat(api.MAX_PAYLOAD_BYTES/3+1)])assert.throws(()=>api.assertCapacity(text),e=>e.code==='tournament-payload-too-large'&&e.bytes===Buffer.byteLength(text));
});
for(const count of [128,320])test(`actual RR ${count} is refused before pending/cache/cloud and preserves original draw`,async()=>{
 const h=controller(draw({format:'roundrobin',count,stations:6})),c=h.make();
 assert.equal(await c.begin(),false);assert.equal(c.status().error,'tournament-payload-too-large');assert.equal(c.blocked(),false);
 assert.deepEqual(h.counts(),{reads:0,writes:0,cached:0,applied:0,success:0});assert.deepEqual(h.original,h.prior);assert.equal(h.storage.size,0);
});
test('actual 320 double draw remains accepted by the payload budget',()=>assert.ok(api.assertCapacity(draw({format:'double',count:320,stations:6})).bytes<api.MAX_PAYLOAD_BYTES));
test('restored oversized pending draw stays recoverable and never writes',async()=>{
 const h=controller(draw({format:'roundrobin',count:128,stations:6}));
 h.storage.set('bxh-bracket-pending-v1:capacity-test',JSON.stringify({baseSignature:api.signature(h.original),snapshot:{...h.ctx.generate(),bracketDraw:{id:'restored'}}}));
 const c=h.make();assert(c.blocked());assert.equal(await c.retry(),false);assert.equal(c.status().error,'tournament-payload-too-large');assert.deepEqual(h.counts(),{reads:0,writes:0,cached:0,applied:0,success:0});assert(h.storage.size);
});
function cloudHarness(){let source=fs.readFileSync('tests/assignment-cloud-confirmation.test.cjs','utf8').split("\ntest('staff save")[0].replace('return {api:context.api,docs,','return {context,api:context.api,docs,');const outer={require};vm.createContext(outer);vm.runInContext(source+'\nglobalThis.h=harness();globalThis.initial=room();',outer);return {h:outer.h,initial:clone(outer.initial)};}
test('actual cloud whole-state sync rejects oversize before changing either mirror',async()=>{
 const {h,initial}=cloudHarness(),before=JSON.stringify([...h.docs]);initial.notes='界'.repeat(api.MAX_PAYLOAD_BYTES/3);
 assert.equal(await h.api.pushUpdate('ROOM',initial),false);assert.equal(h.context.window.__BXH_LAST_CLOUD_ERROR_CODE,'tournament-payload-too-large');assert.equal(JSON.stringify([...h.docs]),before);
});
test('actual cloud final public projection is guarded independently before the first write',async()=>{
 const {h,initial}=cloudHarness(),before=JSON.stringify([...h.docs]);h.context.buildPublicMirrorFields=()=>({notes:'x'.repeat(api.MAX_PAYLOAD_BYTES+1)});
 assert.equal(await h.api.pushUpdate('ROOM',initial),false);assert.equal(h.context.window.__BXH_LAST_CLOUD_ERROR_CODE,'tournament-payload-too-large');assert.equal(JSON.stringify([...h.docs]),before);
});
test('draw UI labels rejected capacity without offering a network retry',()=>{
 const src=fs.readFileSync('modules/main-app/core.js','utf8'),start=src.indexOf('function bracketCommitStatusHtml(){'),end=src.indexOf('\nasync function verifyBracketBeforeStart',start),ctx={bracketCommitController:()=>({status:()=>({error:'tournament-payload-too-large',pending:false})})};vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);assert.match(ctx.bracketCommitStatusHtml(),/原房間與配對維持不變/);ctx.bracketCommitController=()=>({status:()=>({error:'tournament-payload-too-large',pending:true})});const html=ctx.bracketCommitStatusHtml();assert.ok(!html.includes('bracket-commit-retry'));assert.ok(html.includes('bracket-commit-discard'));
});
