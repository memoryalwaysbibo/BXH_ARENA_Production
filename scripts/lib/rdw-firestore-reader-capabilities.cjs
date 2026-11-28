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
  nativeRefs.set(wrapper,{ref,kind:'document'});
  return wrapper;
 }
 function query(ref){
  const wrapper=Object.freeze({
   where:(...args)=>query(ref.where(...args)),
   select:(...args)=>query(ref.select(...args)),
   limit:value=>query(ref.limit(value))
  });
  nativeRefs.set(wrapper,{ref,kind:'query'});
  return wrapper;
 }
 const readerDb=Object.freeze({
  doc:path=>document(db.doc(path)),
  collection:name=>query(db.collection(name))
 });
 // Return safe snapshots, not native snapshots containing writable .ref objects.
 function safeDocument(snapshot){
  return Object.freeze({
   exists:snapshot.exists===true,
   id:snapshot.id,
   data:()=>snapshot.data()
  });
 }
 function safeQuery(snapshot){
  return Object.freeze({
   size:snapshot.size,
   docs:Object.freeze(snapshot.docs.map(safeDocument))
  });
 }
 function makeReadTransaction(tx){
  if(typeof tx?.get!=='function')throw Error('reader-transaction-required');
  return Object.freeze({get:ref=>{
   if(!ref||typeof ref!=='object'||!nativeRefs.has(ref))
    throw Error('reader-reference-not-issued');
   const issued=nativeRefs.get(ref);
   return Promise.resolve(tx.get(issued.ref)).then(snapshot=>
    issued.kind==='query'?safeQuery(snapshot):safeDocument(snapshot));
  }});
 }
 return {readerDb,makeReadTransaction};
}
module.exports={createReaderCapabilities};
