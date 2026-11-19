const {test}=require('node:test'),assert=require('node:assert/strict'),{validate}=require('./public-schema.cjs'),S=require('../../referee-seats/functions/scoring-core.cjs');
const fixture=()=>S.publicProjection({meta:{stations:6},matches:[{id:'m',a:{playerId:'a'},b:{playerId:'b'},log:[]}],updatedAt:1},{meta:{stations:6},players:[]});
test('accept only supported existing public projection',()=>assert.deepEqual(validate(fixture()),fixture()));
test('deny private/unknown nested and top-level values',()=>{for(const mutate of [v=>v.ownerUid='secret',v=>v.matches[0].email='secret',v=>v.matches[0].log.push({uid:'secret'}),v=>v.matches[0].callPass={token:'secret'},v=>v.meta.credential='secret']){const v=fixture();mutate(v);assert.throws(()=>validate(v));}});
