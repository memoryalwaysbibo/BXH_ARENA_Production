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
 const result=await tx.get(safe);
 assert.equal(result.exists,true);
 assert.equal(result.ref,undefined);
 assert.equal(Object.isFrozen(result),true);
 assert.deepEqual(seen,[nativeDoc]);
 assert.equal(Object.isFrozen(tx),true);
 assert.equal(tx.set,undefined);
 assert.throws(()=>tx.get(nativeDoc),/reader-reference-not-issued/);
 assert.throws(()=>tx.get({path:'users/u1'}),/reader-reference-not-issued/);
});
test('query chain exposes only whitelisted immutable read-builder methods',async()=>{
 const {db,nativeQuery}=fixture();
 const {readerDb,makeReadTransaction}=createReaderCapabilities(db);
 const query=readerDb.collection('publicTournaments')
  .where('visibility','==','public').select('eventAuthority').limit(251);
 for(const method of ['get','add','doc','firestore','count','aggregate','set','update','delete'])
  assert.equal(query[method],undefined);
 const nativeDoc={exists:true,id:'BXH-TEST',ref:{set(){throw Error('write')}},data:()=>({visibility:'public'})};
 const tx=makeReadTransaction({get:async ref=>{assert.equal(ref,nativeQuery);return {size:1,docs:[nativeDoc]};}});
 const result=await tx.get(query);
 assert.equal(result.size,1);
 assert.equal(result.docs[0].id,'BXH-TEST');
 assert.equal(result.docs[0].ref,undefined);
 assert.equal(result.docs[0].data().visibility,'public');
 assert.equal(Object.isFrozen(result),true);
 assert.equal(Object.isFrozen(result.docs),true);
 assert.equal(query.limit(2).where('visibility','==','public').select('testMode')!==query,true);
});
test('foreign references and invalid dependencies fail closed',async()=>{
 assert.throws(()=>createReaderCapabilities({}),/reader-db-required/);
 const {readerDb,makeReadTransaction}=createReaderCapabilities(fixture().db);
 assert.throws(()=>makeReadTransaction({}),/reader-transaction-required/);
 const tx=makeReadTransaction({get:async()=>{throw Error('should-not-run')}});
 assert.throws(()=>tx.get(readerDb.doc('users/x').path),/reader-reference-not-issued/);
});

test('native document and query snapshot refs cannot escape reader transaction',async()=>{
 const {db}=fixture();
 const {readerDb,makeReadTransaction}=createReaderCapabilities(db);
 const native={id:'u1',exists:true,ref:{set:()=>{throw Error('write leak')}},data:()=>({tier:'c'})};
 const tx=makeReadTransaction({get:async()=>native});
 const output=await tx.get(readerDb.doc('users/u1'));
 assert.equal(output.data().tier,'c');
 assert.equal('ref' in output,false);
 assert.equal('firestore' in output,false);
 assert.equal('set' in output,false);
});
