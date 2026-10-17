'use strict';
/**
 * TW-06 review-only correction planner. It has no database, auth or network access.
 * Reviewer IDs here are simulation inputs, NOT verified identities.
 * Actual publish/write requires a separately authorized server transaction.
 */
const crypto=require('node:crypto');
const SECTIONS=Object.freeze({
 products:{id:'productId',fields:['displayName','displayNameZhTW']},
 parts:{id:'partId',fields:['displayName','displayNameZhTW','categoryZhTW']},
 variants:{id:'variantId',fields:['displayName','displayNameZhTW']},
 colors:{id:'colorId',fields:['displayName','displayNameZhTW']},
 assemblyClaims:{id:'groupId',fields:['displayName','displayNameZhTW']}
});
const ENTITY_SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
const UID=/^[a-zA-Z0-9_-]{2,80}$/;
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function stable(v){
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 if(isObject(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
function digest(v){return crypto.createHash('sha256').update(stable(v)).digest('hex');}
function requireBatch(batch){
 if(!batch||batch.batchId!=='DATA-01B-20261009-ZHTW-TW05'||batch.productionWritable!==false||batch.autoPublish!==false)throw Error('TW06_RESEARCH_BATCH_REQUIRED');
 if(ENTITY_SECTIONS.some(s=>!Array.isArray(batch[s]))||ENTITY_SECTIONS.reduce((n,s)=>n+batch[s].length,0)!==197)throw Error('TW06_EXPECTED_197');
}
function findRecord(batch,section,id){
 const spec=SECTIONS[section];if(!spec||typeof id!=='string')throw Error('TW06_SECTION_OR_ID_INVALID');
 const rows=batch[section].filter(r=>r[spec.id]===id);
 if(rows.length!==1)throw Error('TW06_RECORD_NOT_UNIQUE');
 return rows[0];
}
function requireIdentity(id,at){
 if(!UID.test(id||'')||!ISO.test(at||'')||Number.isNaN(Date.parse(at)))throw Error('TW06_REVIEWER_AUDIT_REQUIRED');
}
function makeProposal(batch,{section,recordId,changes,proposerId,proposedAt,reason,evidenceUrls}={}){
 requireBatch(batch);requireIdentity(proposerId,proposedAt);
 if(typeof reason!=='string'||reason.trim().length<12)throw Error('TW06_REASON_REQUIRED');
 if(!Array.isArray(evidenceUrls)||!evidenceUrls.length||evidenceUrls.some(u=>typeof u!=='string'||!u.startsWith('https://')))throw Error('TW06_EVIDENCE_REQUIRED');
 if(!isObject(changes)||!Object.keys(changes).length)throw Error('TW06_CHANGES_REQUIRED');
 const current=findRecord(batch,section,recordId),spec=SECTIONS[section];
 for(const [field,value] of Object.entries(changes)){
  if(!spec.fields.includes(field))throw Error('TW06_FIELD_NOT_ALLOWED:'+field);
  if(typeof value!=='string'||!value.trim()||value.length>160)throw Error('TW06_VALUE_INVALID');
  if(current[field]===value)throw Error('TW06_NO_EFFECT');
 }
 // Display and zh-TW name must move together; never leave inconsistent labels.
 if('displayName' in changes||'displayNameZhTW' in changes){
  if(changes.displayName!==changes.displayNameZhTW)throw Error('TW06_DISPLAY_PAIR_REQUIRED');
 }
 const prior=digest(current),normalized=Object.fromEntries(Object.entries(changes).sort(([a],[b])=>a.localeCompare(b)));
 const core={batchId:batch.batchId,section,recordId,prior,changes:normalized,reason:reason.trim(),evidenceUrls:[...new Set(evidenceUrls)].sort(),proposerId,proposedAt};
 return Object.freeze({...core,proposalId:'tw06_'+digest(core).slice(0,28),status:'pending_first_review',productionWritable:false,autoPublish:false});
}
function firstReview(proposal,{reviewerId,reviewedAt,decision,notes}={}){
 requireIdentity(reviewerId,reviewedAt);
 if(reviewerId===proposal?.proposerId)throw Error('TW06_SELF_REVIEW_DENIED');
 if(!['accept','reject'].includes(decision)||typeof notes!=='string'||notes.trim().length<12)throw Error('TW06_DECISION_REQUIRED');
 if(proposal.status!=='pending_first_review')throw Error('TW06_BAD_STAGE');
 return Object.freeze({...proposal,status:decision==='accept'?'pending_second_review':'rejected',
  firstReview:{reviewerId,reviewedAt,decision,notes:notes.trim()},productionWritable:false,autoPublish:false});
}
function secondReview(proposal,{reviewerId,reviewedAt,decision,notes}={}){
 requireIdentity(reviewerId,reviewedAt);
 if(proposal?.status!=='pending_second_review'||proposal.firstReview?.decision!=='accept')throw Error('TW06_BAD_STAGE');
 if([proposal.proposerId,proposal.firstReview.reviewerId].includes(reviewerId))throw Error('TW06_INDEPENDENT_REVIEW_REQUIRED');
 if(!['approve','reject'].includes(decision)||typeof notes!=='string'||notes.trim().length<12)throw Error('TW06_DECISION_REQUIRED');
 return Object.freeze({...proposal,status:decision==='approve'?'approved_for_draft_only':'rejected',
  secondReview:{reviewerId,reviewedAt,decision,notes:notes.trim()},productionWritable:false,autoPublish:false});
}
function previewCorrection(batch,proposal){
 requireBatch(batch);
 if(!proposal||proposal.batchId!==batch.batchId||!SECTIONS[proposal.section])throw Error('TW06_PROPOSAL_SCOPE_INVALID');
 const record=findRecord(batch,proposal.section,proposal.recordId);
 if(digest(record)!==proposal.prior)throw Error('TW06_STALE_RECORD');
 // Revalidate untrusted proposal content and allowed fields before any draft change.
 const canonical=makeProposal(batch,{section:proposal.section,recordId:proposal.recordId,changes:proposal.changes,
  proposerId:proposal.proposerId,proposedAt:proposal.proposedAt,reason:proposal.reason,evidenceUrls:proposal.evidenceUrls});
 if(canonical.proposalId!==proposal.proposalId||canonical.prior!==proposal.prior)throw Error('TW06_PROPOSAL_TAMPERED');
 return {proposalId:proposal.proposalId,section:proposal.section,recordId:proposal.recordId,
  before:Object.fromEntries(Object.keys(proposal.changes).map(k=>[k,record[k]??null])),
  after:structuredClone(proposal.changes),reviewStatus:proposal.status,
  canPublish:false,canWriteProduction:false};
}
function applyApprovedToDraft(batch,proposal){
 const preview=previewCorrection(batch,proposal);
 if(proposal.status!=='approved_for_draft_only'||proposal.firstReview?.decision!=='accept'||proposal.secondReview?.decision!=='approve')throw Error('TW06_APPROVAL_REQUIRED');
 if(new Set([proposal.proposerId,proposal.firstReview.reviewerId,proposal.secondReview.reviewerId]).size!==3)throw Error('TW06_INDEPENDENT_REVIEW_REQUIRED');
 const out=structuredClone(batch);
 const record=findRecord(out,proposal.section,proposal.recordId);
 Object.assign(record,proposal.changes);
 out.batchId='DATA-01B-20261009-ZHTW-TW06-DRAFT';
 out.batchRevision=8;out.localizationRevision=6;
 out.tw06ChangeLog=[{proposalId:proposal.proposalId,section:proposal.section,recordId:proposal.recordId,
  before:preview.before,after:preview.after,priorHash:proposal.prior,
  afterHash:digest(record),reviewers:[proposal.firstReview.reviewerId,proposal.secondReview.reviewerId],
  evidenceUrls:[...proposal.evidenceUrls],status:'draft_only'}];
 out.productionWritable=false;out.autoPublish=false;
 return out;
}
function revertDraftCorrection(draft){
 if(draft?.batchId!=='DATA-01B-20261009-ZHTW-TW06-DRAFT'||!Array.isArray(draft.tw06ChangeLog)||draft.tw06ChangeLog.length!==1)throw Error('TW06_DRAFT_REQUIRED');
 const log=draft.tw06ChangeLog[0],out=structuredClone(draft),record=findRecord(out,log.section,log.recordId);
 if(digest(record)!==log.afterHash)throw Error('TW06_ROLLBACK_CONFLICT');
 for(const [field,prior] of Object.entries(log.before)){
  if(prior===null)delete record[field];else record[field]=prior;
 }
 out.batchId='DATA-01B-20261009-ZHTW-TW05';
 out.batchRevision=7;out.localizationRevision=5;
 delete out.tw06ChangeLog;
 return out;
}
module.exports={SECTIONS,digest,makeProposal,firstReview,secondReview,previewCorrection,applyApprovedToDraft,revertDraftCorrection};
