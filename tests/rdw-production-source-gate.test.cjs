const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {assess}=require('../scripts/lib/rdw-production-source-gate.cjs');
const parity=JSON.parse(fs.readFileSync('qr-checkin/runtime-source-parity.json','utf8'));
test('current court-call provenance inventory blocks RDW production integration',()=>{
 const r=assess(parity);assert.equal(r.service,'courtCallService');assert.equal(r.status,'blocked');assert.equal(r.reason,'deployed-source-not-verified');
});
test('reference match does not imply live runtime approval',()=>{
 const r=assess(parity,'familyRegistration');assert.equal(r.status,'reference-match-present');assert.equal(r.reason,'requires-current-runtime-reverification');
});
test('missing inventory and unknown service fail closed',()=>{
 assert.throws(()=>assess(null),/parity-inventory-invalid/);
 assert.equal(assess(parity,'missingService').status,'blocked');
});
