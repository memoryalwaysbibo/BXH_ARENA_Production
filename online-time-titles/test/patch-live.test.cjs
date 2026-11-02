'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {patchLive}=require('../patch-live.cjs');
const source='function conditionProgress(definition, stats) {\n  switch(definition.conditionType) {\n    case "total_checkins": return Number(stats.totalCheckInDays || 0);\n    default: return 0;\n  }\n}\nasync function evaluateTitles(rows) {\n const writes=[];\n for(const doc of rows){\n      const def = doc.data();\n      writes.push(def.conditionType);\n }\n return writes;\n}';
test('live evaluator patch preserves check-in progress and accepts uncapped time only as valid milliseconds',()=>{
  const out=patchLive(source,{evaluator:true});
  const fn=vm.runInNewContext(out.index+'\nconditionProgress;');
  assert.equal(fn({conditionType:'total_checkins'},{totalCheckInDays:7}),7);
  assert.equal(fn({conditionType:'total_online_minutes'},{officialOnlineTimeMs:5*3600000}),300);
  for(const bad of [-1,NaN,Infinity,'3600000',Number.MAX_SAFE_INTEGER+1])assert.equal(fn({conditionType:'total_online_minutes'},{officialOnlineTimeMs:bad}),0);
  assert.equal(out.deployAllowed,false);
});
test('generic maintenance cannot overwrite online progress from an older stats snapshot',async()=>{
  const out=patchLive(source,{evaluator:true});
  const run=vm.runInNewContext(out.index+'\nevaluateTitles;');
  const rows=['total_online_minutes','total_checkins'].map(conditionType=>({data:()=>({conditionType})}));
  assert.equal(JSON.stringify(await run(rows)),JSON.stringify(['total_checkins']));
});
test('live patcher rejects unknown source and duplicate patches before producing a candidate',()=>{
  assert.throws(()=>patchLive(source),/explicit-patch-role/);
  assert.throws(()=>patchLive(source.replace('total_checkins','changed'),{evaluator:true}),/anchor-changed/);
  assert.throws(()=>patchLive(patchLive(source,{evaluator:true}).index,{evaluator:true}),/already-patched/);
  assert.throws(()=>patchLive(source,{definitionEditor:true}),/definition-editor-contract/);
});
