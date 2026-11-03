const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const A=require('../modules/referee-license/legacy-import.js');
const {setup}=require('./referee-license-legacy-fixture.cjs');
test('20 batches, real existing service, 1966 decisions, zero event/rank/photo/user changes',async()=>{
 const x=setup(),users=x.plan.people.map(p=>x.db.read('users/'+p.uid));
 const r=await A.execute(x.plan,x.call,x.storage,()=>{});
 assert.equal(r.status,'verified');assert.equal(r.confirmedBatches,20);assert.equal(r.total,1966);assert.equal(x.mutations(),20);
 assert.deepEqual(x.plan.people.map(p=>x.db.read('users/'+p.uid)),users);
 assert.equal(x.db.read('refereeCertificateSystem/numbering').lastIssuedNumber,18);
 assert.equal(x.db.read('refereeCertificates/'+x.owner).photoDataUrl,'existing-photo');
 for(const [i,p] of x.plan.people.entries()) {const s=(await x.call({action:'get',targetUid:p.uid})).snapshot;assert.equal(s.stats.decisions,p.count);assert.equal(s.stats.eventCount,0);assert.equal(s.certificate.awardedLevel,1);}
 await assert.rejects(A.execute(x.plan,x.call,x.storage,()=>{}),/prior-run/);assert.equal(x.mutations(),20);
});
test('committed response lost stops after one mutation; never retries',async()=>{
 const x=setup();const call=async d=>{const r=await x.call(d);if(d.action==='saveBackfill')throw Error('lost-response');return r;};
 const r=await A.execute(x.plan,call,x.storage,()=>{});assert.equal(r.status,'outcome-unknown');assert.equal(x.mutations(),1);assert.equal(r.confirmedBatches,0);assert.ok(r.pending);
 const s=(await x.call({action:'get',targetUid:x.owner})).snapshot;assert.equal(s.stats.decisions,200);
 await assert.rejects(A.execute(x.plan,x.call,x.storage,()=>{}),/prior-run/);assert.equal(x.mutations(),1);
});
test('readonly preflight detects existing data; no mutation',async()=>{
 const x=setup();x.db.put('refereeCertificates/'+x.owner,{...x.db.read('refereeCertificates/'+x.owner),awardedLevel:2});
 const r=await A.execute(x.plan,x.call,x.storage,()=>{});assert.equal(r.status,'stopped');assert.equal(x.mutations(),0);
});
test('session change before first mutation stops',async()=>{
 const x=setup();let gets=0;const call=async d=>{if(d.action==='get'&&!d.targetUid&&++gets===2)x.setActor(x.plan.people[1].uid);return x.call(d);};
 const r=await A.execute(x.plan,call,x.storage,()=>{});assert.equal(r.status,'stopped');assert.equal(x.mutations(),0);
});
test('journal storage failure prevents write',async()=>{
 const x=setup();x.storage.setItem=()=>{throw Error('quota')};const r=await A.execute(x.plan,x.call,x.storage,()=>{});assert.equal(r.status,'stopped');assert.equal(x.mutations(),0);
});
test('file hash mismatch never accepted',async()=>{await assert.rejects(A.validatePlan(new TextEncoder().encode('{}')),/sha-mismatch/);});
