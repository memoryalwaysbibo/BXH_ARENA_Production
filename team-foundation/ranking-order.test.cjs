'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {rankSnapshot}=require('./ranking-order.cjs');
test('snapshot ranks over 200 teams without truncating ties across page boundaries',()=>{
 const rows=Array.from({length:225},(_,i)=>({id:'team'+String(i).padStart(3,'0'),strength:i<23?100:90})).reverse();
 const ranked=rankSnapshot(rows);assert.equal(ranked.length,225);assert.equal(ranked[19].rank,1);assert.equal(ranked[22].rank,1);assert.equal(ranked[23].rank,24);assert.equal(ranked[224].rank,24);assert.equal(rows[0].rank,undefined);
});
test('snapshot rejects duplicates, malformed identifiers and invalid scores',()=>{
 for(const rows of [[{id:'a',strength:1},{id:'a',strength:2}],[{id:'bad/id',strength:1}],[{id:'a',strength:NaN}],[{id:'a',strength:-1}]])assert.throws(()=>rankSnapshot(rows),/invalid-ranking-row/);
});
