'use strict';
function memory(){
 const data=new Map();let queue=Promise.resolve();
 const collection=path=>({path,doc:id=>({key:path+'/'+id,id,collection:name=>collection(path+'/'+id+'/'+name)}),orderBy:()=>query(path)});
 const query=(path,cursor='',size=Infinity)=>({path,cursor,size,limit:n=>query(path,cursor,n),startAfter:c=>query(path,c,size)});
 const db={projectId:'demo-arena-pk',collection,runTransaction(fn){const job=queue.then(async()=>{
  const copy=new Map([...data].map(([k,v])=>[k,structuredClone(v)]));let wrote=false;
  const snap=key=>({id:key.split('/').at(-1),exists:copy.has(key),data:()=>structuredClone(copy.get(key))});
  const read=()=>{if(wrote)throw Error('read-after-write');};
  const tx={getAll:async(...refs)=>{read();return refs.map(r=>snap(r.key));},get:async q=>{read();return {docs:[...copy.keys()].filter(k=>k.startsWith(q.path+'/')&&k.slice(q.path.length+1).indexOf('/')<0&&k.slice(q.path.length+1)>q.cursor).sort().slice(0,q.size).map(snap)};},set(r,v){wrote=true;copy.set(r.key,structuredClone(v));},create(r,v){wrote=true;if(copy.has(r.key))throw Error('exists');copy.set(r.key,structuredClone(v));}};
  const out=await fn(tx);data.clear();for(const [k,v]of copy)data.set(k,v);return out;
 });queue=job.catch(()=>{});return job;}};
 return {db,data};
}
module.exports={memory};
