'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {persistReview}=require('../../modules/bey-catalog/review-emulator-persistence.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
const draft={draftId:'draft_emulator_1',reviewStatus:'requires_authorized_source_review',evidenceStatus:'pending',publicationStatus:'unpublished',canAutoPublish:false,scope:'exact_stock_configuration_only',partIds:['blade_1','ratchet_1','bit_1'],sourceRefs:[{sourceId:'manufacturer_1',authority:'manufacturer',url:'https://example.org/official',locator:'package list'}]};
const tokenVerifier={verifyIdToken:async token=>{if(!['admin_a','admin_b','player_1','tester_1','inactive_1'].includes(token))throw Error('INVALID_TOKEN');return {uid:token,firebase:{sign_in_provider:'password'}}}};
let env;
async function setup(){if(env)return env;env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});await env.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore();await Promise.all([
 setDoc(doc(db,'users','admin_a'),{role:'admin',active:true}),
 setDoc(doc(db,'users','admin_b'),{role:'super_admin',active:true}),
 setDoc(doc(db,'users','player_1'),{role:'player',active:true}),
 setDoc(doc(db,'users','tester_1'),{role:'admin',active:true,isTestAccount:true}),
 setDoc(doc(db,'users','inactive_1'),{role:'admin',active:false})
]);});return env;}
after(async()=>{if(env)await env.cleanup()});
const opts=(db,idToken,action,extra={})=>({db,target,authVerifier:tokenVerifier,idToken,draft,action,notes:'Evidence independently verified',sourceRechecked:true,...extra});
test('only verified active admin can write first review, player/tester/inactive denied',async()=>{
 const e=await setup();await e.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore();for(const uid of ['player_1','tester_1','inactive_1'])await assert.rejects(()=>persistReview(opts(db,uid,'accept')),/ADMIN_ROLE_REQUIRED/);const r=await persistReview(opts(db,'admin_a','accept'));assert.equal(r.phase,'awaiting_second');});
});
test('second independent admin approval persisted but not published',async()=>{
 const e=await setup();await e.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore();await assert.rejects(()=>persistReview(opts(db,'admin_a','approve')),/INDEPENDENT_REVIEWER_REQUIRED/);const r=await persistReview(opts(db,'admin_b','approve'));assert.equal(r.phase,'ready_for_server_verification');const saved=(await getDoc(doc(db,'beyCatalogReviewDrafts',draft.draftId))).data();assert.equal(saved.reviewLog.length,2);assert.equal(saved.publicationStatus,'unpublished');assert.equal(saved.selectable,false);});
});
test('tampered draft cannot reuse prior review',async()=>{
 const e=await setup();await e.withSecurityRulesDisabled(async ctx=>{await assert.rejects(()=>persistReview(opts(ctx.firestore(),'admin_b','approve',{draft:{...draft,partIds:['blade_1','ratchet_1','changed']}})),/DRAFT_CHANGED_NEW_REVIEW_REQUIRED/);});
});
test('browser cannot read or write server review records',async()=>{
 const e=await setup(),db=e.authenticatedContext('admin_a').firestore();await assertFails(getDoc(doc(db,'beyCatalogReviewDrafts',draft.draftId)));await assertFails(setDoc(doc(db,'beyCatalogReviewDrafts','forged'),{phase:'ready_for_server_verification'}));
});
test('reject remote emulator or mismatched project before writing',async()=>{
 const e=await setup();await e.withSecurityRulesDisabled(async ctx=>{await assert.rejects(()=>persistReview({...opts(ctx.firestore(),'admin_a','accept'),target:{...target,projectId:'bxh-arena'}}),/PRODUCTION/);});
});
