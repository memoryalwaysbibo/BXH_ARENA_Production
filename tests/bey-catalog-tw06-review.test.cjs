'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeProposal,firstReview,secondReview,previewCorrection,applyApprovedToDraft,revertDraftCorrection}=require('../modules/bey-catalog/catalog-tw06-review.cjs');
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function fixture(){
 const x={batchId:'DATA-01B-20261009-ZHTW-TW05',batchRevision:7,localizationRevision:5,productionWritable:false,autoPublish:false,
 sources:[],products:[{productId:'product_000001',displayName:'魔導神杖 5-70DB',displayNameZhTW:'魔導神杖 5-70DB',productCode:'UX-03'}],
 parts:[{partId:'part_000001',displayName:'魔導神杖',displayNameZhTW:'魔導神杖',category:'blade',selectable:false}],
 variants:[],colors:[{colorId:'black',displayName:'黑色',displayNameZhTW:'黑色'}],
 options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 while(SECTIONS.reduce((n,s)=>n+x[s].length,0)<197)x.issues.push({issueId:'issue_'+x.issues.length});
 return x;
}
const change={section:'parts',recordId:'part_000001',changes:{displayName:'魔導神杖（新版台灣名稱）',displayNameZhTW:'魔導神杖（新版台灣名稱）'},
 proposerId:'editor_1',proposedAt:'2026-10-09T05:00:00Z',reason:'依台灣原廠商品名稱更新顯示',
 evidenceUrls:['https://example.org/official']};
function approved(batch){
 const p=makeProposal(batch,change);
 const a=firstReview(p,{reviewerId:'reviewer_1',reviewedAt:'2026-10-09T05:10:00Z',decision:'accept',notes:'已重新檢查來源與原始名稱'});
 return secondReview(a,{reviewerId:'reviewer_2',reviewedAt:'2026-10-09T05:20:00Z',decision:'approve',notes:'第二位審核者已獨立比對來源'});
}
test('correction preview is deterministic and does not modify 197 original entities',()=>{
 const batch=fixture(),snapshot=JSON.stringify(batch);
 const a=makeProposal(batch,change),b=makeProposal(batch,{...change,changes:{displayNameZhTW:change.changes.displayNameZhTW,displayName:change.changes.displayName}});
 assert.equal(a.proposalId,b.proposalId);
 const preview=previewCorrection(batch,a);
 assert.equal(preview.before.displayName,'魔導神杖');
 assert.equal(preview.after.displayName,'魔導神杖（新版台灣名稱）');
 assert.equal(preview.canPublish,false);
 assert.equal(JSON.stringify(batch),snapshot);
});
test('cannot alter part IDs, source links, structural categories, verification or publication flags',()=>{
 for(const changes of [{partId:'forged'},{category:'ratchet'},{selectable:true},{publicationStatus:'published'},{sourceProductId:'other'},{manufacturerColorVerified:true}]){
  assert.throws(()=>makeProposal(fixture(),{...change,changes}),/TW06_FIELD_NOT_ALLOWED/);
 }
});
test('zh-TW displayName and displayNameZhTW must agree',()=>{
 assert.throws(()=>makeProposal(fixture(),{...change,changes:{displayName:'改名'}}),/TW06_DISPLAY_PAIR_REQUIRED/);
 assert.throws(()=>makeProposal(fixture(),{...change,changes:{displayName:'甲',displayNameZhTW:'乙'}}),/TW06_DISPLAY_PAIR_REQUIRED/);
});
test('three independent people required; no self-approval or missing evidence',()=>{
 const batch=fixture(),p=makeProposal(batch,change);
 assert.throws(()=>firstReview(p,{reviewerId:'editor_1',reviewedAt:'2026-10-09T05:10:00Z',decision:'accept',notes:'已重新檢查來源與原始名稱'}),/TW06_SELF_REVIEW_DENIED/);
 assert.throws(()=>makeProposal(batch,{...change,evidenceUrls:[]}),/TW06_EVIDENCE_REQUIRED/);
 const first=firstReview(p,{reviewerId:'reviewer_1',reviewedAt:'2026-10-09T05:10:00Z',decision:'accept',notes:'已重新檢查來源與原始名稱'});
 assert.throws(()=>secondReview(first,{reviewerId:'reviewer_1',reviewedAt:'2026-10-09T05:20:00Z',decision:'approve',notes:'第二位審核者已獨立比對來源'}),/TW06_INDEPENDENT_REVIEW_REQUIRED/);
});
test('rejected proposal cannot be applied and approved proposal stays draft only',()=>{
 const batch=fixture(),p=makeProposal(batch,change);
 assert.throws(()=>applyApprovedToDraft(batch,p),/TW06_APPROVAL_REQUIRED/);
 const rejected=firstReview(p,{reviewerId:'reviewer_1',reviewedAt:'2026-10-09T05:10:00Z',decision:'reject',notes:'來源無法支持這個名稱'});
 assert.throws(()=>applyApprovedToDraft(batch,rejected),/TW06_APPROVAL_REQUIRED/);
 const accepted=approved(batch),out=applyApprovedToDraft(batch,accepted);
 assert.equal(out.parts[0].displayName,'魔導神杖（新版台灣名稱）');
 assert.equal(out.parts[0].partId,'part_000001');
 assert.equal(out.parts[0].selectable,false);
 assert.equal(out.productionWritable,false);assert.equal(out.autoPublish,false);
 assert.equal(out.tw06ChangeLog[0].status,'draft_only');
 assert.equal(SECTIONS.reduce((n,s)=>n+out[s].length,0),197);
});
test('rollback restores previous draft snapshot; stale base and modified draft are rejected',()=>{
 const batch=fixture(),p=approved(batch),out=applyApprovedToDraft(batch,p);
 const reverted=revertDraftCorrection(out);
 assert.deepEqual(reverted,batch);
 const stale=fixture();stale.parts[0].displayName='已由其他管理員修改';
 assert.throws(()=>applyApprovedToDraft(stale,p),/TW06_STALE_RECORD/);
 out.parts[0].displayName='意外覆蓋';
 assert.throws(()=>revertDraftCorrection(out),/TW06_ROLLBACK_CONFLICT/);
});
test('wrong batch or malformed data cannot be used as a production write',()=>{
 assert.throws(()=>makeProposal({...fixture(),productionWritable:true},change),/TW06_RESEARCH_BATCH_REQUIRED/);
 assert.throws(()=>makeProposal({...fixture(),batchId:'production'},change),/TW06_RESEARCH_BATCH_REQUIRED/);
 assert.throws(()=>makeProposal({...fixture(),issues:[]},change),/TW06_EXPECTED_197/);
});

test('forged correction payload cannot bypass field allowlist or proposal digest',()=>{
 const batch=fixture(),p=approved(batch);
 assert.throws(()=>applyApprovedToDraft(batch,{...p,changes:{partId:'evil'}}),/TW06_FIELD_NOT_ALLOWED/);
 assert.throws(()=>applyApprovedToDraft(batch,{...p,changes:{displayName:'偽造名稱',displayNameZhTW:'偽造名稱'}}),/TW06_PROPOSAL_TAMPERED/);
 assert.throws(()=>applyApprovedToDraft(batch,{...p,proposalId:'tw06_forged'}),/TW06_PROPOSAL_TAMPERED/);
});
