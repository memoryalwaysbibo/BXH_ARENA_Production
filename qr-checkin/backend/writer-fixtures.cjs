'use strict';
// Execute the hash-pinned deployed modules with a real, guarded emulator DB.
const path=require('node:path');
const {createHash}=require('node:crypto');
const fixtures=require('../reference/writer-handlers.json');
const manifest=require('../reference/backend-sources-20261016.json');
const {guardFirestore}=require('./guard-firestore.cjs');
function loadWriter(service,entry,db){
 const cache=new Map(),files=manifest.functions.find(f=>f.name===service)?.files;
 if(!files)throw Error('unknown-writer-fixture');
 const guarded=guardFirestore(db);
 function load(name){
  name=path.posix.normalize(name);if(name.startsWith('../')||path.posix.isAbsolute(name))throw Error('unsafe-writer-fixture');
  if(!path.posix.extname(name))name+='.js';
  if(cache.has(name))return cache.get(name).exports;
  const sha=fixtures.files[service+'/'+name],source=fixtures.blobs[sha];
  if(typeof source!=='string'||files[name]?.sha256!==sha||Buffer.byteLength(source)!==files[name]?.bytes||createHash('sha256').update(source).digest('hex')!==sha)throw Error('writer-fixture-source-mismatch: '+service+'/'+name);
  const module={exports:{}};cache.set(name,module);
  function resolve(dependency){
   if(dependency.startsWith('.'))return load(path.posix.join(path.posix.dirname(name),dependency));
   if(dependency==='firebase-admin/firestore')return {...require(dependency),getFirestore:()=>guarded};
   if(dependency==='firebase-functions/v2/https')return {...require(dependency),onCall:(_options,handler)=>handler};
   return require(dependency);
  }
  new Function('require','module','exports',source+'\n//# sourceURL=pinned-'+service+'/'+name)(resolve,module,module.exports);
  return module.exports;
 }
 return load(entry);
}
module.exports={loadWriter};
