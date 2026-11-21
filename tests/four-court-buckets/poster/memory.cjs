'use strict';
const assert=require('node:assert/strict'),clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function memory(){
 const rows=new Map(),versions=new Map(),created=new Map(),writes=[];let interfere;let serial=0;
 const put=(p,d)=>{rows.set(p,clone(d));versions.set(p,++serial);if(!created.has(p))created.set(p,serial);};
 const snapshot=p=>{const value=clone(rows.get(p)),exists=rows.has(p),born=created.get(p),version=versions.get(p)||0;return {id:p.split('/').at(-1),ref:ref(p),exists,data:()=>clone(value),createTime:exists?{seconds:born,nanoseconds:0}:undefined,updateTime:{seconds:version,nanoseconds:0,toMillis:()=>version*1000}};};
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:c=>query(p+'/'+c),get:async()=>snapshot(p)});
 function query(p){let maximum=Infinity;const filters=[];const q={query:true,path:p,doc:id=>ref(p+'/'+id),where(...f){filters.push(f);return q;},limit(n){maximum=n;return q;},orderBy(){return q;},get:async()=>{const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')&&filters.every(([f,op,v])=>op==='=='&&rows.get(k)[f]===v)).slice(0,maximum).map(snapshot);return {docs,size:docs.length,empty:!docs.length};}};return q;}
 function apply(kind,p,value,options){if(kind==='create')assert(!rows.has(p));writes.push({kind,path:p,value:clone(value),options:clone(options)});if(kind==='delete'){rows.delete(p);created.delete(p);versions.set(p,++serial);return;}const next=kind==='update'||options?.merge?{...rows.get(p)}:{};for(const [k,v]of Object.entries(value)){if(v&&v.__increment!==undefined)next[k]=Number(next[k]||0)+v.__increment;else if(v&&v.__arrayUnion){next[k]=[...(next[k]||[])];for(const item of v.__arrayUnion)if(!next[k].some(old=>JSON.stringify(old)===JSON.stringify(item)))next[k].push(clone(item));}else next[k]=clone(v);}put(p,next);}
 const db={projectId:'demo-bxh-four-court-buckets',doc:ref,collection:query,getAll:async(...refs)=>Promise.all(refs.map(r=>r.get())),runTransaction:async cb=>{for(let attempt=0;attempt<4;attempt++){
  const reads=new Map(),pending=[];const get=async r=>{assert.equal(pending.length,0,'read after write');if(r.query)return r.get();reads.set(r.path,versions.get(r.path)||0);return snapshot(r.path);};
  const tx={get,getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,d,o)=>pending.push(['set',r.path,d,o]),update:(r,d)=>pending.push(['update',r.path,d]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
  const result=await cb(tx);if(interfere&&pending.length){const fn=interfere;interfere=null;fn();}
  if([...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;pending.forEach(args=>apply(...args));return result;
 }throw Error('retry exhausted');}};
 return {db,rows,put,writes,snapshot,remove:p=>{rows.delete(p);created.delete(p);versions.set(p,++serial);},set interfere(x){interfere=x;}};
}
module.exports={memory};
