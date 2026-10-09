'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {createRelease}=require('../../modules/bey-catalog/assembly-rule-registry.cjs');
const {stageReleaseProposal}=require('../../modules/bey-catalog/release-emulator-persistence.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
let env;
async function setup(){if(!env)env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});return env;}
after(async()=>{if(env)await env.cleanup()});
function release(id,result='compatible'){return createRelease({releaseId:id,createdBy:'admin_a',createdAt:'2026-10-09T02:00:00Z',rules:[{ruleId:'rule_a',version:id,result,evidenceStatus:'verified',partIds:['blade_a','ratchet_a','bit_a'],sourceId:'official_a',sourceUrl:'https://example.org/official',reviewedBy:'admin_a',reviewedAt:'2026-10-09T02:00:00Z'}]});}
function review(overrides={}){return {phase:'ready_for_server_verification',publicationStatus:'unpublished',selectable:false,firstReviewerUid:'admin_a',secondReviewerUid:'admin_b',reviewLog:[{uid:'admin_a',action:'accept'},{uid:'admin_b',action:'approve'}],...overrides};}
test('approved evidence creates unpublished immutable proposal and replay is idempotent',async()=>{
 const e=await setup(),rel=release('catalog_emulator_v1');
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),draftId='draft_release_a';
  await setDoc(doc(db,'beyCatalogReviewDrafts',draftId),review());
  const a=await stageReleaseProposal({db,target,release:rel,draftId});
  const b=await stageReleaseProposal({db,target,release:rel,draftId});
  assert.equal(a.status,'created');assert.equal(b.status,'unchanged');
  const saved=(await getDoc(doc(db,'beyCatalogRuleReleases',rel.releaseId))).data();
  assert.equal(saved.publicationStatus,'unpublished');assert.equal(saved.active,false);assert.equal(saved.selectable,false);
 });
});
test('conflicting release ID cannot overwrite original proposal',async()=>{
 const e=await setup(),draftId='draft_release_a';
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),bad=release('catalog_emulator_v1','incompatible');
  await assert.rejects(()=>stageReleaseProposal({db,target,release:bad,draftId}),/RELEASE_ID_CONFLICT/);
  assert.equal((await getDoc(doc(db,'beyCatalogRuleReleases','catalog_emulator_v1'))).data().checksum,release('catalog_emulator_v1').checksum);
 });
});
test('rejected or self-approved review cannot create release proposal',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),rel=release('catalog_emulator_v2');
  await setDoc(doc(db,'beyCatalogReviewDrafts','draft_rejected'),review({phase:'rejected'}));
  await assert.rejects(()=>stageReleaseProposal({db,target,release:rel,draftId:'draft_rejected'}),/REVIEW_NOT_FINAL/);
  await setDoc(doc(db,'beyCatalogReviewDrafts','draft_self'),review({secondReviewerUid:'admin_a'}));
  await assert.rejects(()=>stageReleaseProposal({db,target,release:rel,draftId:'draft_self'}),/TWO_REVIEWERS_REQUIRED/);
 });
});
test('browser cannot forge rule releases, production target forbidden',async()=>{
 const e=await setup(),client=e.authenticatedContext('admin_a').firestore();
 await assertFails(setDoc(doc(client,'beyCatalogRuleReleases','forged'),{publicationStatus:'published'}));
 await e.withSecurityRulesDisabled(async ctx=>{
  await assert.rejects(()=>stageReleaseProposal({db:ctx.firestore(),target:{...target,projectId:'bxh-arena'},release:release('catalog_emulator_v3'),draftId:'draft_release_a'}),/PRODUCTION/);
 });
});
