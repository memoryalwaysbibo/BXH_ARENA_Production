'use strict';
// Firestore reference capabilities exposed to an audited Hunter reader.
// References are opaque: the real DocumentReference / Query never leaves
// this module, and only tx.get() can unwrap issued references.
// NOT a replacement for source review, least-privilege IAM or isolation.
function createReaderCapabilities(db){
 if(typeof db?.doc!=='function'||typeof db?.collection!=='function')
  throw Error('reader-db-required');
 const nativeRefs=new WeakMap();
 function document(ref){
  const wrapper=Object.freeze({path:ref.path});
  nativeRefs.set(wrapper,ref);
  return wrapper;
 }
 function query(ref){
  const wrapper=Object.freeze({
   where:(...args)=>query(ref.where(...args)),
   select:(...args)=>query(ref.select(...args)),
   limit:value=>query(ref.limit(value))
  });
  nativeRefs.set(wrapper,ref);
  return wrapper;
 }
 const readerDb=Object.freeze({
  doc:path=>document(db.doc(path)),
  collection:name=>query(db.collection(name))
 });
 function makeReadTransaction(tx){
  if(typeof tx?.get!=='function')throw Error('reader-transaction-required');
  return Object.freeze({get:ref=>{
   if(!ref||typeof ref!=='object'||!nativeRefs.has(ref))
    throw Error('reader-reference-not-issued');
   return tx.get(nativeRefs.get(ref));
  }});
 }
 return {readerDb,makeReadTransaction};
}
module.exports={createReaderCapabilities};
