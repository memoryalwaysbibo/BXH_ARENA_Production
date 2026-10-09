'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {collection,getDocs,doc,setDoc,getDoc}=require('firebase/firestore');
const {createTw14EmulatorGuards,LIMIT,WINDOW_MS}=require('../../modules/bey-catalog/catalog-tw14-emulator-guards.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
const operation='tw12.catalog.review.read';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
let env;
async function setup(){
 if(!env)env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});
 return env;
}
after(async()=>{if(env)await env.cleanup()});
test('quota accepts five calls and rejects sixth, with a new fixed window',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  const first=createTw14EmulatorGuards({db,target,clock:()=>WINDOW_MS*123});
  for(let i=0;i<LIMIT;i++)assert.equal(await first.consumeRateLimit({uid:'tw14_quota_a',operation}),true);
  assert.equal(await first.consumeRateLimit({uid:'tw14_quota_a',operation}),false);
  const next=createTw14EmulatorGuards({db,target,clock:()=>WINDOW_MS*124});
  assert.equal(await next.consumeRateLimit({uid:'tw14_quota_a',operation}),true);
 });
});
test('concurrent calls never exceed atomic quota',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const guard=createTw14EmulatorGuards({db:ctx.firestore(),target,clock:()=>WINDOW_MS*222});
  const results=await Promise.all(Array.from({length:9},()=>guard.consumeRateLimit({uid:'tw14_quota_race',operation})));
  assert.equal(results.filter(Boolean).length,LIMIT);
  assert.equal(results.filter(x=>!x).length,4);
 });
});
test('audit persists only approved metadata, no UID, tokens or raw query',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),guard=createTw14EmulatorGuards({db,target});
  assert.equal(await guard.recordAudit({uid:'tw14_audit_1',operation,outcome:'preview',count:10,filter:'P0',sourceBatchId:'DATA-01B-20261009-ZHTW-TW05'}),true);
  assert.equal(await guard.recordAudit({uid:'tw14_audit_2',operation,outcome:'denied',count:0,filter:'all',sourceBatchId:null}),true);
  const all=await getDocs(collection(db,'beyCatalogTw14Audit'));
  assert.equal(all.size,2);
  for(const snap of all.docs){
   const d=snap.data(),s=JSON.stringify(d);
   assert.equal(d.publicationStatus,'unpublished');assert(d.recordedAt);
   assert.match(d.actorHash,/^[a-f0-9]{64}$/);
   assert(!s.includes('tw14_audit_'));assert(!s.includes('Bearer '));
   assert(!Object.hasOwn(d,'query'));assert(!Object.hasOwn(d,'idToken'));
  }
 });
});
test('invalid audit payloads, operation and production project fail closed',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),guard=createTw14EmulatorGuards({db,target});
  await assert.rejects(()=>guard.recordAudit({uid:'tw14_actor',operation,outcome:'approved',count:0,filter:'all',sourceBatchId:null}),/TW14_INVALID_AUDIT_METADATA/);
  await assert.rejects(()=>guard.recordAudit({uid:'tw14_actor',operation,outcome:'denied',count:1,filter:'all',sourceBatchId:null}),/TW14_DENIED_AUDIT_INVALID/);
  await assert.rejects(()=>guard.consumeRateLimit({uid:'tw14_actor',operation:'publish'}),/TW14_INVALID_ACTOR_OR_OPERATION/);
  assert.throws(()=>createTw14EmulatorGuards({db,target:{...target,projectId:'production'}}),/PRODUCTION|UNEXPECTED_DEMO_PROJECT|NOT_ALLOWED/);
 });
});
test('client cannot read or write quota and audit documents',async()=>{
 const e=await setup(),db=e.authenticatedContext('admin_a').firestore();
 await assertFails(setDoc(doc(db,'beyCatalogTw14Quota','forged'),{count:0}));
 await assertFails(setDoc(doc(db,'beyCatalogTw14Audit','forged'),{outcome:'preview'}));
 await assertFails(getDoc(doc(db,'beyCatalogTw14Quota','forged')));
 await assertFails(getDoc(doc(db,'beyCatalogTw14Audit','forged')));
});
