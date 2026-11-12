'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReaderCapabilities}=require('../scripts/lib/rdw-firestore-reader-capabilities.cjs');
function fixture(){
 const nativeDoc={path:'users/u1',set(){throw Error('write must never run')},update(){throw Error('write must never run')},delete(){throw Error('write must never run')}};
 const nativeQuery={path:'publicTournaments',get(){throw Error('direct fetch must never run')},
  where(){return this},select(){return this},limit(){return this}};
 const db={doc:()=>nativeDoc,collection:()=>nativeQuery,
  batch(){throw Error('write batch must never run')},
  runTransaction(){throw Error('nested transaction must never run')}};
 return {nativeDoc,nativeQuery,db};
}
test('document read handle has no native Firestore write method or db back-reference',async()=>{
 const {nativeDoc,db}=fixture();
 const {readerDb,makeReadTransaction}=createReaderCapabilities(db);
 const safe=readerDb.doc('users/u1');
 assert.equal(safe.path,'users/u1');
 for(const name of ['set','update','delete','create','firestore','parent','ref'])
  assert.equal(safe[name],undefined);
 assert.equal(Object.isFrozen(safe),true);
 const seen=[];
 const tx=makeReadTransaction({get:async ref=>{seen.push(ref);return {exists:true};}});
 assert.equal((await tx.get(safe)).exists,true);
 assert.deepEqual(seen,[nativeDoc]);
 assert.equal(Object.isFrozen(tx),true);
 assert.equal(tx.set,undefined);
 await assert.rejects(tx.get(nativeDoc),/reader-reference-not-issued/);
 await assert.rejects(tx.get({path:'users/u1'}),/reader-reference-not-issued/);
});
test('query chain exposes only whitelisted immutable read-builder methods',async()=>{
 const {db,nativeQuery}=fixture();
 const {readerDb,makeReadTransaction}=createReaderCapabilities(db);
 const query=readerDb.collection('publicTournaments')
  .where('visibility','==','public').select('eventAuthority').limit(251);
 for(const method of ['get','add','doc','firestore','count','aggregate','set','update','delete'])
  assert.equal(query[method],undefined);
 const tx=makeReadTransaction({get:async ref=>{assert.equal(ref,nativeQuery);return {size:0,docs:[]};}});
 assert.equal((await tx.get(query)).size,0);
 assert.equal(query.limit(2).where('visibility','==','public').select('testMode')!==query,true);
});
test('foreign references and invalid dependencies fail closed',async()=>{
 assert.throws(()=>createReaderCapabilities({}),/reader-db-required/);
 const {readerDb,makeReadTransaction}=createReaderCapabilities(fixture().db);
 assert.throws(()=>makeReadTransaction({}),/reader-transaction-required/);
 const tx=makeReadTransaction({get:async()=>{throw Error('should-not-run')}});
 await assert.rejects(tx.get(readerDb.doc('users/x').path),/reader-reference-not-issued/);
});
