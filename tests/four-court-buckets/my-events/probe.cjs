'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {fixture,load,specs,code}=require('../settlement/probe.cjs');
const {normalizeLifecycle}=require('./deployed-lifecycle.cjs');
const deployedHash='e04fd69c5c3e1a4df8673722693620fed6e3e5cfb3e500db43badc2b6c28c65f';
test('fixture is the exact captured My Events lifecycle normalizer',()=>{
 const bytes=require('node:fs').readFileSync(require.resolve('./deployed-lifecycle.cjs'));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),deployedHash);
});
test('six-court bucket room has a pre-settlement My Events classification gap',async()=>{
 const f=fixture({courts:6});
 const root=f.m.rows.get('tournaments/'+code);
 assert.equal(root.scoreStorage.courtCount,6);
 assert.equal(JSON.parse(root.data).matches.every(m=>m.completed),true);
 const before=normalizeLifecycle(root);
 assert.deepEqual(before,{status:'invalid',reason:'contradictory-private-phase'});
 // The candidate settlement is separate; the case above does not read or write production.
 const spec=specs.find(x=>x.function==='settleLadderTournament');
 const result=await load(spec,true,f.m).invoke();
 assert.equal(result.ok,true,result.reason);
 const after=normalizeLifecycle(f.m.rows.get('tournaments/'+code));
 assert.deepEqual(after,{status:'supported',phase:'done',active:false});
});
test('the copied normalizer has no bucket-document input',()=>{
 const f=fixture({courts:6});
 const root=f.m.rows.get('tournaments/'+code);
 const first=normalizeLifecycle(root);
 const path='tournaments/'+code+'/matchBuckets/court-1';
 f.m.put(path,{...f.m.rows.get(path),matches:'invalid-bucket-json'});
 assert.deepEqual(normalizeLifecycle(root),first);
});
