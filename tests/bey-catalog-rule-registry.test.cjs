'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRelease,registerRelease,activateRelease,evaluateWithActiveRelease}=require('../modules/bey-catalog/assembly-rule-registry.cjs');
const stamp='2026-10-09T01:00:00Z';
const parts=[{partId:'blade_a',category:'blade',selectable:true},{partId:'ratchet_a',category:'ratchet',selectable:true},{partId:'bit_a',category:'bit',selectable:true}];
function rule(overrides={}){return {ruleId:'rule_1',version:'catalog_v1',result:'compatible',evidenceStatus:'verified',partIds:parts.map(x=>x.partId),sourceId:'official_1',sourceUrl:'https://example.org/source',reviewedBy:'admin_1',reviewedAt:stamp,...overrides};}
function release(overrides={}){return createRelease({releaseId:'catalog_v1',createdBy:'admin_1',createdAt:stamp,rules:[rule()],...overrides});}
function state(){return {activeReleaseId:null,releases:[],history:[]};}
test('approved release is immutable and has stable checksum',()=>{
 const a=release(),b=release();assert.equal(a.checksum,b.checksum);assert(Object.isFrozen(a));assert(Object.isFrozen(a.rules));assert(Object.isFrozen(a.rules[0].partIds));
});
test('evidence source, reviewer and rule version required',()=>{
 for(const bad of [{sourceUrl:'http://example.org'},{sourceId:''},{reviewedBy:''},{evidenceStatus:'pending'},{version:'catalog_v0'},{partIds:[]}]){
  assert.throws(()=>release({rules:[rule(bad)]}));
 }
});
test('rejects duplicate and contradictory rules',()=>{
 assert.throws(()=>release({rules:[rule(),rule()]}),/DUPLICATE_RULE_ID/);
 assert.throws(()=>release({rules:[rule(),rule({ruleId:'rule_2',result:'incompatible'})]}),/CONTRADICTORY_RULES/);
});
test('registration and activation require checksum, actor, reason and expected active',()=>{
 const a=release(),s=registerRelease(state(),a);
 assert.throws(()=>registerRelease(s,a),/RELEASE_ID_ALREADY_EXISTS/);
 assert.throws(()=>activateRelease(s,a,{actor:'admin_1',reason:'reviewed original',expectedActive:'catalog_v0'}),/STALE_ACTIVE_RELEASE/);
 assert.throws(()=>activateRelease(s,a,{actor:'admin_1',reason:'short',expectedActive:null}),/CHANGE_AUDIT_REQUIRED/);
 const active=activateRelease(s,a,{actor:'admin_1',reason:'original approved',expectedActive:null});
 assert.equal(active.activeReleaseId,'catalog_v1');assert.equal(active.history.length,1);
 assert.equal(evaluateWithActiveRelease({state:active,parts,template:'standard_3'}).status,'verified');
});
test('rollback activates prior immutable version, retains both and audit',()=>{
 const a=release(),b=createRelease({releaseId:'catalog_v2',createdBy:'admin_1',createdAt:stamp,rules:[rule({ruleId:'rule_2',version:'catalog_v2',result:'incompatible'})]});
 let s=registerRelease(registerRelease(state(),a),b);
 s=activateRelease(s,a,{actor:'admin_1',reason:'first approved release',expectedActive:null});
 s=activateRelease(s,b,{actor:'admin_1',reason:'revised physical check',expectedActive:'catalog_v1'});
 assert.equal(evaluateWithActiveRelease({state:s,parts,template:'standard_3'}).status,'invalid');
 s=activateRelease(s,a,{actor:'admin_1',reason:'rollback erroneous rule',expectedActive:'catalog_v2'});
 assert.equal(evaluateWithActiveRelease({state:s,parts,template:'standard_3'}).status,'verified');
 assert.equal(s.history.length,3);assert.equal(s.releases.length,2);
});
test('no active release and altered release data fail closed',()=>{
 assert.equal(evaluateWithActiveRelease({state:state(),parts,template:'standard_3'}).status,'pending');
 const a=release(),s={activeReleaseId:'catalog_v1',releases:[{...a,rules:[]}],history:[]};
 assert.equal(evaluateWithActiveRelease({state:s,parts,template:'standard_3'}).reason,'RELEASE_INTEGRITY_FAILED');
});
test('unpublished parts remain pending even with positive verified evidence',()=>{
 const a=release(),s=activateRelease(registerRelease(state(),a),a,{actor:'admin_1',reason:'original approved',expectedActive:null});
 assert.equal(evaluateWithActiveRelease({state:s,parts:[{...parts[0],selectable:false},...parts.slice(1)],template:'standard_3'}).status,'pending');
});
