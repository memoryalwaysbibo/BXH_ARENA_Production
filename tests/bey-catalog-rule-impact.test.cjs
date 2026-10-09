'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRelease,registerRelease,activateRelease}=require('../modules/bey-catalog/assembly-rule-registry.cjs');
const {impactPreview}=require('../modules/bey-catalog/rule-change-impact.cjs');
const date='2026-10-09T01:00:00Z';
const parts=[{partId:'blade_a',category:'blade',selectable:true},{partId:'ratchet_a',category:'ratchet',selectable:true},{partId:'bit_a',category:'bit',selectable:true}];
function release(id,result){return createRelease({releaseId:id,createdBy:'admin_1',createdAt:date,rules:[{ruleId:'rule_1',version:id,result,evidenceStatus:'verified',partIds:parts.map(p=>p.partId),sourceId:'official_1',sourceUrl:'https://example.org/evidence',reviewedBy:'admin_1',reviewedAt:date}]});}
test('preview shows invalidation but never changes active release or player data',()=>{
 const old=release('catalog_v1','compatible'),next=release('catalog_v2','incompatible');
 const state=activateRelease(registerRelease({activeReleaseId:null,releases:[],history:[]},old),old,{actor:'admin_1',reason:'approved baseline',expectedActive:null});
 const configs=[{configId:'cfg_1',parts,template:'standard_3'}];
 const result=impactPreview({state,candidateRelease:next,configurations:configs});
 assert.equal(result.changed,1);assert.equal(result.affected[0].before,'verified');assert.equal(result.affected[0].after,'invalid');
 assert.equal(result.playerRecordsMutated,0);assert.equal(result.officialResultsMutated,0);assert.equal(state.activeReleaseId,'catalog_v1');
});
test('unchanged release yields no impacted configurations',()=>{
 const old=release('catalog_v1','compatible'),next=release('catalog_v2','compatible');
 const state=activateRelease(registerRelease({activeReleaseId:null,releases:[],history:[]},old),old,{actor:'admin_1',reason:'approved baseline',expectedActive:null});
 assert.equal(impactPreview({state,candidateRelease:next,configurations:[{configId:'cfg_1',parts,template:'standard_3'}]}).changed,0);
});
test('duplicate config identifiers rejected',()=>{
 const old=release('catalog_v1','compatible'),next=release('catalog_v2','incompatible');
 const state=activateRelease(registerRelease({activeReleaseId:null,releases:[],history:[]},old),old,{actor:'admin_1',reason:'approved baseline',expectedActive:null});
 const row={configId:'cfg_1',parts,template:'standard_3'};
 assert.throws(()=>impactPreview({state,candidateRelease:next,configurations:[row,row]}),/INVALID_CONFIGURATIONS/);
});
