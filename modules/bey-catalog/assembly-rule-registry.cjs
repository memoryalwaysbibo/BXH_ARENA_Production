'use strict';
/**
 * DB-02 immutable rule releases and reversible activation.
 * No Firestore SDK, network, UI, or production side effects.
 */
const crypto=require('node:crypto');
const {validateAssembly}=require('./assembly-validator.cjs');
const RELEASE_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;
function stable(v){
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
function hash(v){return crypto.createHash('sha256').update(stable(v)).digest('hex');}
function fail(message){throw Error(message);}
function validateRule(rule,releaseId){
 if(!rule||!ID.test(rule.ruleId||''))fail('INVALID_RULE_ID');
 if(rule.version!==releaseId)fail('RULE_VERSION_MISMATCH');
 if(!['compatible','incompatible'].includes(rule.result))fail('INVALID_RULE_RESULT');
 if(rule.evidenceStatus!=='verified')fail('EVIDENCE_NOT_VERIFIED');
 if(!Array.isArray(rule.partIds)||rule.partIds.length<2||new Set(rule.partIds).size!==rule.partIds.length||rule.partIds.some(x=>!ID.test(x)))fail('INVALID_RULE_PARTS');
 if(!ID.test(rule.sourceId||'')||!rule.sourceUrl?.startsWith('https://'))fail('SOURCE_REQUIRED');
 if(!ID.test(rule.reviewedBy||'')||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(rule.reviewedAt||''))fail('REVIEW_REQUIRED');
}
function createRelease({releaseId,rules,createdBy,createdAt}={}){
 if(!RELEASE_ID.test(releaseId||''))fail('INVALID_RELEASE_ID');
 if(!ID.test(createdBy||'')||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(createdAt||''))fail('RELEASE_AUDIT_REQUIRED');
 if(!Array.isArray(rules))fail('RULES_REQUIRED');
 const ids=new Set(),sets=new Map();
 for(const rule of rules){
  validateRule(rule,releaseId);
  if(ids.has(rule.ruleId))fail('DUPLICATE_RULE_ID');
  ids.add(rule.ruleId);
  const key=[...rule.partIds].sort().join('|');
  const existing=sets.get(key);
  if(existing&&existing!==rule.result)fail('CONTRADICTORY_RULES');
  sets.set(key,rule.result);
 }
 const clean=rules.map(r=>({...r,partIds:[...r.partIds].sort()})).sort((a,b)=>a.ruleId.localeCompare(b.ruleId));
 const payload={releaseId,createdBy,createdAt,rules:clean};
 const checksum=hash(payload);
 return deepFreeze({...payload,checksum,immutable:true});
}
function deepFreeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v;}
function activateRelease(state,release,{actor,reason,expectedActive}={}){
 if(!state||!Array.isArray(state.releases)||!RELEASE_ID.test(release?.releaseId||''))fail('STATE_OR_RELEASE_INVALID');
 if(!ID.test(actor||'')||typeof reason!=='string'||reason.trim().length<8)fail('CHANGE_AUDIT_REQUIRED');
 if(state.activeReleaseId!==expectedActive)fail('STALE_ACTIVE_RELEASE');
 const registered=state.releases.find(r=>r.releaseId===release.releaseId);
 if(!registered||registered.checksum!==release.checksum)fail('UNREGISTERED_RELEASE');
 return deepFreeze({...state,activeReleaseId:release.releaseId,history:[...(state.history||[]),{from:state.activeReleaseId||null,to:release.releaseId,actor,reason:reason.trim()}]});
}
function registerRelease(state,release){
 if(!state||!Array.isArray(state.releases)||!release?.immutable||!release.checksum)fail('INVALID_RELEASE');
 if(state.releases.some(r=>r.releaseId===release.releaseId))fail('RELEASE_ID_ALREADY_EXISTS');
 // Validate checksum, not merely an arbitrary immutable flag.
 if(hash({releaseId:release.releaseId,createdBy:release.createdBy,createdAt:release.createdAt,rules:release.rules})!==release.checksum)fail('RELEASE_CHECKSUM_MISMATCH');
 return deepFreeze({...state,releases:[...state.releases,release]});
}
function evaluateWithActiveRelease({state,parts,template}={}){
 const release=state?.releases?.find(r=>r.releaseId===state.activeReleaseId);
 if(!release)return {status:'pending',reason:'NO_ACTIVE_RELEASE',canSaveAsVerified:false};
 if(hash({releaseId:release.releaseId,createdBy:release.createdBy,createdAt:release.createdAt,rules:release.rules})!==release.checksum)return {status:'pending',reason:'RELEASE_INTEGRITY_FAILED',canSaveAsVerified:false};
 return validateAssembly({parts,template,interfaceRules:release.rules,ruleVersion:release.releaseId});
}
module.exports={createRelease,registerRelease,activateRelease,evaluateWithActiveRelease,hash};
