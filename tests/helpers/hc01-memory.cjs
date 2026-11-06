'use strict';
// Atomic in-memory transaction adapter for unit tests/local demonstration only.
function memory(){
  const data=new Map();let queue=Promise.resolve();
  const db={projectId:'demo-hunter-clash',collection:name=>({doc:id=>({key:name+'/'+id})}),
    runTransaction(fn){const pending=queue.then(async()=>{
      const snapshot=new Map([...data].map(([k,v])=>[k,structuredClone(v)]));
      const tx={getAll:async(...refs)=>refs.map(ref=>({exists:snapshot.has(ref.key),data:()=>structuredClone(snapshot.get(ref.key))})),
        create(ref,value){if(snapshot.has(ref.key))throw Error('already-exists');snapshot.set(ref.key,structuredClone(value));},
        set(ref,value){snapshot.set(ref.key,structuredClone(value));}};
      const result=await fn(tx);data.clear();for(const [k,v]of snapshot)data.set(k,v);return result;
    });queue=pending.catch(()=>{});return pending;}};
  return {db,data};
}
module.exports={memory};
