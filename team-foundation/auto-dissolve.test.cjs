'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAutoDissolver,BATCH_LIMIT}=require('./auto-dissolve.cjs');
function fixture(team,member={teamId:'t'}){
 const data=new Map([['teamsV1/t',structuredClone(team)],['teamMembershipsV1/c',member]]);
 const db={doc:p=>p,runTransaction:async fn=>{const writes=[];let writing=false;const tx={get:async p=>{assert.equal(writing,false);return {exists:data.has(p),data:()=>structuredClone(data.get(p))};}};for(const op of ['update','delete','create'])tx[op]=(p,v)=>{writing=true;writes.push([op,p,v]);};const result=await fn(tx);for(const [op,p,v]of writes){if(op==='delete')data.delete(p);else data.set(p,op==='update'?{...data.get(p),...v}:v);}return result;}};
 return {data,worker:createAutoDissolver({db,clock:()=>86400100,newId:()=> 'history'})};
}
const solo={status:'active',captainUid:'c',memberUids:['c'],roles:{c:'captain'},totalXp:0,understaffedSince:100,dissolveAt:86400100};
test('due solo team dissolves atomically and replays as no-op',async()=>{
 const f=fixture(solo);assert.equal(await f.worker.dissolveCandidate('t'),true);assert.equal(f.data.get('teamsV1/t').status,'dissolved');assert.equal(f.data.has('teamMembershipsV1/c'),false);assert.equal(f.data.get('teamsV1/t/history/history').method,'auto-dissolve');assert.equal(await f.worker.dissolveCandidate('t'),false);
});
test('team recovered, before deadline, and inconsistent membership never dissolve',async()=>{
 for(const team of [{...solo,memberUids:['c','m']},{...solo,dissolveAt:86400101},{...solo,understaffedSince:200}]){const f=fixture(team),before=JSON.stringify([...f.data]);assert.equal(await f.worker.dissolveCandidate('t'),false);assert.equal(JSON.stringify([...f.data]),before);}
 const f=fixture(solo,{teamId:'other'}),before=JSON.stringify([...f.data]);await assert.rejects(f.worker.dissolveCandidate('t'),/membership-inconsistent/);assert.equal(JSON.stringify([...f.data]),before);assert.equal(BATCH_LIMIT,20);
});
