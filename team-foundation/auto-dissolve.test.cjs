'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAutoDissolver,BATCH_LIMIT}=require('./auto-dissolve.cjs');
function fixture(team,member={teamId:'t'}){
 const data=new Map([['teamsV1/t',structuredClone(team)],['teamMembershipsV1/c',member],['publicPlayers/c',{publicName:'黑爸',email:'private'}]]);
 const db={doc:p=>p,runTransaction:async fn=>{const writes=[];let writing=false;const tx={get:async p=>{assert.equal(writing,false);return {exists:data.has(p),data:()=>structuredClone(data.get(p))};}};for(const op of ['update','delete','create'])tx[op]=(p,v)=>{writing=true;writes.push([op,p,v]);};const result=await fn(tx);for(const [op,p,v]of writes){if(op==='delete')data.delete(p);else data.set(p,op==='update'?{...data.get(p),...v}:v);}return result;}};
 return {data,worker:createAutoDissolver({db,clock:()=>86400100,newId:()=> 'history'})};
}
const solo={status:'active',captainUid:'c',memberUids:['c'],roles:{c:'captain'},totalXp:0,understaffedSince:100,dissolveAt:86400100};
test('due solo team dissolves atomically and replays as no-op',async()=>{
 const f=fixture(solo);assert.equal(await f.worker.dissolveCandidate('t'),true);assert.equal(f.data.get('teamsV1/t').status,'dissolved');assert.equal(f.data.has('teamMembershipsV1/c'),false);assert.equal(f.data.get('teamsV1/t/history/history').method,'auto-dissolve');assert.equal(f.data.get('teamsV1/t/history/history').subjectName,'黑爸');assert.equal(await f.worker.dissolveCandidate('t'),false);
});
test('team recovered, before deadline, and inconsistent membership never dissolve',async()=>{
 for(const team of [{...solo,memberUids:['c','m']},{...solo,dissolveAt:86400101},{...solo,understaffedSince:200}]){const f=fixture(team),before=JSON.stringify([...f.data]);assert.equal(await f.worker.dissolveCandidate('t'),false);assert.equal(JSON.stringify([...f.data]),before);}
 const f=fixture(solo,{teamId:'other'}),before=JSON.stringify([...f.data]);await assert.rejects(f.worker.dissolveCandidate('t'),/membership-inconsistent/);assert.equal(JSON.stringify([...f.data]),before);assert.equal(BATCH_LIMIT,20);
});

test('one invalid team cannot stop other due teams in the same batch',async()=>{
 const data=new Map([['teamsV1/bad',{...solo,captainUid:'bad',memberUids:['bad'],roles:{bad:'captain'}}],['teamMembershipsV1/bad',{teamId:'elsewhere'}],['teamsV1/good',solo],['teamMembershipsV1/c',{teamId:'good'}]]);
 const query={where(){return this;},orderBy(){return this;},limit(n){assert.equal(n,20);return this;},async get(){return {docs:[{id:'bad'},{id:'good'}]};}};
 const db={doc:p=>p,collection:()=>query,runTransaction:async fn=>{const writes=[],tx={get:async p=>({exists:data.has(p),data:()=>data.get(p)}),update:(p,v)=>writes.push(['update',p,v]),delete:p=>writes.push(['delete',p]),create:(p,v)=>writes.push(['create',p,v])};const result=await fn(tx);for(const [op,p,v] of writes){if(op==='delete')data.delete(p);else data.set(p,op==='update'?{...data.get(p),...v}:v);}return result;}};
 const worker=createAutoDissolver({db,clock:()=>86400100,newId:()=> 'h'});assert.deepEqual(await worker.runBatch(),{examined:2,dissolved:1,failed:1,mayHaveMore:false});assert.equal(data.get('teamsV1/good').status,'dissolved');assert.equal(data.get('teamsV1/bad').status,'active');
});

test('sweep advances past a full page of invalid teams without exceeding batch limit',async()=>{
 const docs=Array.from({length:21},(_,i)=>({id:'team'+i}));const queries=[];
 const db={doc:p=>p,collection:()=>{let cursor=null;return {where(){return this;},orderBy(){return this;},startAfter(doc){cursor=doc;return this;},limit(n){assert.equal(n,20);return this;},async get(){const start=cursor?docs.indexOf(cursor)+1:0;queries.push(start);return {docs:docs.slice(start,start+20)};}};},runTransaction:async fn=>fn({get:async p=>({exists:true,data:()=>p.startsWith('teamsV1/')?{...solo,captainUid:p.slice(8),memberUids:[p.slice(8)],roles:{}}:{teamId:'different'}})})};
 const result=await createAutoDissolver({db,clock:()=>86400100}).runSweep();assert.deepEqual(queries,[0,20]);assert.equal(result.failed,21);assert.equal(result.batches,2);assert.equal(result.mayHaveMore,false);
});
