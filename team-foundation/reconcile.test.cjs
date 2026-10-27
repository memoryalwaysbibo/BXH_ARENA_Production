'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createReconciler,LIMIT}=require('./reconcile.cjs');
function fixture({fail=null}={}){
 const docs=new Map([['hunterLeaderboardMeta/current',{generation:'g1793095800000-abcdefabcdef'}],['ladderSystem/current',{currentSeason:'S1'}]]),ids=Array.from({length:12},(_,i)=>'t'+String(i).padStart(2,'0')),calls=[];let n=0;
 const db={doc:p=>({path:p,get:async()=>({exists:docs.has(p),data:()=>docs.get(p)})}),runTransaction:async fn=>{const writes=[];const result=await fn({get:async r=>({exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))}),set:(r,v)=>writes.push(['set',r.path,v]),update:(r,v)=>writes.push(['update',r.path,v])});for(const [op,p,v]of writes)docs.set(p,op==='set'?v:{...docs.get(p),...v});return result;},collection:()=>{let cursor=null;const q={orderBy:()=>q,limit:()=>q,startAfter:v=>(cursor=v,q),get:async()=>({docs:ids.filter(x=>!cursor||x>cursor).slice(0,LIMIT).map(id=>({id}))})};return q;}};
 const api=createReconciler({db,documentId:'__name__',enabled:()=>true,clock:()=>1000,newId:()=>String(++n),refresh:async id=>{calls.push(id);if(id===fail)throw Error('refresh-failed');}});
 return {api,docs,calls};
}
test('bounded pages resume after cursor and duplicate source event is ignored',async()=>{
 const f=fixture();assert.equal((await f.api.enqueue()).status,'queued');assert.equal((await f.api.enqueue()).status,'unchanged');assert.deepEqual(await f.api.runBatch(),{status:'more',processed:10});assert.deepEqual(await f.api.runBatch(),{status:'done',processed:2});assert.equal(new Set(f.calls).size,12);assert.equal((await f.api.runBatch()).status,'idle');
});
test('failure does not advance cursor and subsequent retry can complete',async()=>{
 const f=fixture({fail:'t02'});await f.api.enqueue();await assert.rejects(f.api.runBatch(),/refresh-failed/);const job=f.docs.get('teamProjectionControlV1/current');assert.equal(job.cursor,null);assert.equal(job.state,'pending');assert.equal(job.leaseId,null);
});
test('changed generation resets cursor and revision, duplicate source cannot reset finished work',async()=>{
 const f=fixture();await f.api.enqueue();await f.api.runBatch();f.docs.get('hunterLeaderboardMeta/current').generation='g1793095800001-abcdefabcdef';const result=await f.api.enqueue();assert.equal(result.revision,2);assert.equal(f.docs.get('teamProjectionControlV1/current').cursor,null);
});
test('active lease prevents concurrent worker',async()=>{
 const f=fixture();await f.api.enqueue();const job=f.docs.get('teamProjectionControlV1/current');job.leaseId='busy';job.leaseUntil=2000;assert.equal((await f.api.runBatch()).status,'idle');assert.equal(f.calls.length,0);
});
