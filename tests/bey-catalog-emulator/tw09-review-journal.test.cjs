'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {makeProposal,digest}=require('../../modules/bey-catalog/catalog-tw06-review.cjs');
const {recordTw09Decision}=require('../../modules/bey-catalog/catalog-tw09-review-emulator.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
const verifier={verifyIdToken:async (token,revoked)=>{
 assert.equal(revoked,true);
 if(!['admin_a','admin_b','admin_c','editor_1','player_a','test_admin','disabled_admin','anonymous'].includes(token))throw Error('TOKEN_REVOKED_OR_INVALID');
 return {uid:token==='anonymous'?'anon_user':token,firebase:{sign_in_provider:token==='anonymous'?'anonymous':'password'}};
}};
let env;
async function setup(){
 if(env)return env;
 env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const [uid,role,active,isTestAccount] of [
   ['admin_a','admin',true,false],['admin_b','admin',true,false],['admin_c','super_admin',true,false],['editor_1','admin',true,false],
   ['player_a','player',true,false],['test_admin','admin',true,true],['disabled_admin','admin',false,false]
  ])await setDoc(doc(db,'users',uid),{role,active,isTestAccount});
 });
 return env;
}
after(async()=>{if(env)await env.cleanup()});
const sections=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function research(){
 const x={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
 sources:[],products:[],parts:[{partId:'part_000001',displayName:'魔導神杖',displayNameZhTW:'魔導神杖',category:'blade'}],
 variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 while(sections.reduce((n,s)=>n+x[s].length,0)<197)x.issues.push({issueId:'issue_'+x.issues.length});
 return x;
}
function proposal(suffix){
 return makeProposal(research(),{section:'parts',recordId:'part_000001',
  changes:{displayName:'魔導神杖 '+suffix,displayNameZhTW:'魔導神杖 '+suffix},
  proposerId:'editor_1',proposedAt:'2026-10-09T06:00:00Z',reason:'台灣繁體名稱來源交叉審核',
  evidenceUrls:['https://example.org/official']});
}
async function seed(db,p){
 await setDoc(doc(db,'beyCatalogTw09Proposals',p.proposalId),{
  batchId:p.batchId,proposal:p,proposalHash:digest(p),proposerUid:p.proposerId,
  publicationStatus:'unpublished',productionWritable:false,autoPublish:false
 });
}
const call=(db,p,idToken,decision)=>recordTw09Decision({
 db,target,authVerifier:verifier,idToken,proposalId:p.proposalId,decision,notes:'已獨立核對台灣繁體名稱與來源'});
test('two independent reviewers persist audit events, no catalog or player writes',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),p=proposal('first');await seed(db,p);
  const first=await call(db,p,'admin_a','accept');
  const second=await call(db,p,'admin_b','approve');
  assert.equal(first.phase,'awaiting_second');assert.equal(second.phase,'approved_for_draft_only');
  assert.equal(second.published,false);assert.equal(second.catalogDocumentsChanged,0);assert.equal(second.playerRecordsChanged,0);
  const saved=(await getDoc(doc(db,'beyCatalogTw09Reviews',p.proposalId))).data();
  assert.equal(saved.firstReviewerUid,'admin_a');assert.equal(saved.secondReviewerUid,'admin_b');
  assert.equal(saved.publicationStatus,'unpublished');assert.equal(saved.selectable,false);
  assert.equal(saved.revision,2);assert(saved.updatedAt);
  for(const stage of ['first','second']){
   const event=(await getDoc(doc(db,'beyCatalogTw09ReviewEvents',p.proposalId+'_'+stage))).data();
   assert.equal(event.publicationStatus,'unpublished');assert(event.reviewedAt);
  }
 });
});
test('player, test admin, disabled admin, proposer and anonymous cannot review',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),p=proposal('roles');await seed(db,p);
  for(const uid of ['player_a','test_admin','disabled_admin'])
   await assert.rejects(()=>call(db,p,uid,'accept'),/TW09_ADMIN_REQUIRED/);
  await assert.rejects(()=>call(db,p,'anonymous','accept'),/TW09_VERIFIED_USER_REQUIRED/);
  await assert.rejects(()=>call(db,p,'editor_1','accept'),/TW09_SELF_REVIEW_DENIED/);
  const forged=await recordTw09Decision({db,target,authVerifier:{verifyIdToken:async()=>({uid:'editor_1'})},
   idToken:'editor',proposalId:p.proposalId,decision:'accept',notes:'已獨立核對台灣繁體名稱與來源'}).catch(e=>e);
  assert.match(forged.message,/TW09_SELF_REVIEW_DENIED/);
 });
});
test('same reviewer cannot approve and rejection is terminal',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),p=proposal('self');await seed(db,p);
  await call(db,p,'admin_a','accept');
  await assert.rejects(()=>call(db,p,'admin_a','approve'),/TW09_INDEPENDENT_REVIEWER_REQUIRED/);
  await call(db,p,'admin_b','reject');
  await assert.rejects(()=>call(db,p,'admin_c','approve'),/TW09_REVIEW_ALREADY_FINALIZED/);
 });
});
test('canonical tampering and unknown proposal are rejected',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),p=proposal('tamper');await seed(db,p);
  await setDoc(doc(db,'beyCatalogTw09Proposals',p.proposalId),{
   batchId:p.batchId,proposal:p,proposalHash:'forged',proposerUid:p.proposerId,
   publicationStatus:'unpublished',productionWritable:false,autoPublish:false
  });
  await assert.rejects(()=>call(db,p,'admin_a','accept'),/TW09_CANONICAL_PROPOSAL_INVALID/);
  const unknown=proposal('missing');
  await assert.rejects(()=>call(db,unknown,'admin_a','accept'),/TW09_CANONICAL_PROPOSAL_INVALID/);
 });
});
test('revoking first reviewer before second approval blocks finalization',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),p=proposal('revocation');await seed(db,p);
  await call(db,p,'admin_a','accept');
  await setDoc(doc(db,'users','admin_a'),{role:'player',active:true,isTestAccount:false});
  try{
   await assert.rejects(()=>call(db,p,'admin_b','approve'),/TW09_FIRST_REVIEWER_REVOKED/);
   const saved=(await getDoc(doc(db,'beyCatalogTw09Reviews',p.proposalId))).data();
   assert.equal(saved.phase,'awaiting_second');
  }finally{
   await setDoc(doc(db,'users','admin_a'),{role:'admin',active:true,isTestAccount:false});
  }
 });
});
test('two simultaneous first reviews produce exactly one winner',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),p=proposal('race');await seed(db,p);
  const results=await Promise.allSettled([call(db,p,'admin_a','accept'),call(db,p,'admin_b','accept')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  const state=(await getDoc(doc(db,'beyCatalogTw09Reviews',p.proposalId))).data();
  assert.equal(state.phase,'awaiting_second');
 });
});
test('browser cannot forge review or audit; production target rejected',async()=>{
 const e=await setup(),client=e.authenticatedContext('admin_c').firestore();
 await assertFails(setDoc(doc(client,'beyCatalogTw09Reviews','forged'),{phase:'approved_for_draft_only'}));
 await assertFails(getDoc(doc(client,'beyCatalogTw09Reviews','forged')));
 await assertFails(setDoc(doc(client,'beyCatalogTw09ReviewEvents','forged'),{actorUid:'admin_c'}));
 await e.withSecurityRulesDisabled(async ctx=>{
  const p=proposal('production');
  await assert.rejects(()=>recordTw09Decision({...{
   db:ctx.firestore(),target:{...target,projectId:'bxh-arena'},
   authVerifier:verifier,idToken:'admin_c',proposalId:p.proposalId,
   decision:'accept',notes:'已獨立核對台灣繁體名稱與來源'
  }}),/PRODUCTION/);
 });
});
