'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReadService}=require('./read-service.cjs');
test('history pages continue after the last document even when timestamps match',async()=>{
 const docs=Array.from({length:65},(_,i)=>({id:'h'+String(i).padStart(2,'0'),data:()=>({subjectName:'玩家'+i,actorName:'隊長',actorRole:'captain',method:'approve',occurredAt:100})}));
 const byId=new Map(docs.map(x=>[x.id,x]));const queries=[];
 const db={doc:p=>p,collection:p=>({orderBy:()=>{let after=null;const q={startAfter:s=>(after=s.id,q),limit:n=>({query:true,after,n,path:p})};return q;}}),runTransaction:fn=>fn({get:async path=>{
  if(typeof path==='object'){queries.push(path);const start=path.after?docs.findIndex(x=>x.id===path.after)+1:0;return {docs:docs.slice(start,start+path.n)};}
  if(path==='teamsV1/t')return {exists:true,data:()=>({status:'active',memberUids:['u'],captainUid:'u'})};
  if(path==='teamMembershipsV1/u')return {exists:true,data:()=>({teamId:'t'})};
  const doc=byId.get(path.split('/').pop());return doc?{...doc,exists:true}:{exists:false};
 }})};
 const read=createReadService({db});const first=await read({actorUid:'u',action:'history',teamId:'t'});assert.equal(first.items.length,50);assert.equal(first.nextCursor,'h49');
 const second=await read({actorUid:'u',action:'history',teamId:'t',cursor:first.nextCursor});assert.equal(second.items.length,15);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,65);assert.ok(queries.every(q=>q.n===51));
 await assert.rejects(read({actorUid:'u',action:'history',teamId:'t',cursor:'../bad'}),/invalid-history-cursor/);
});
