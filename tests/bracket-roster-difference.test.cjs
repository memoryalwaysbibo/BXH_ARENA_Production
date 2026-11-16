'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rosterDifference,createServer}=require('../modules/main-app/bracket-commit.js');
const state=(players,revision=1)=>({id:'room-1',cloudCode:'BXH-TEST',players,registrationRosterRevision:revision,matches:[],meta:{formatType:'single',battleMode:'individual'}});
test('reports individual cloud additions, removals, check-in changes and revisions without guessing from counts',()=>{
 const local=state([{id:'a',name:'甲',checkedIn:false},{id:'b',name:'乙',checkedIn:true}],1);
 const cloud=state([{id:'a',name:'甲',checkedIn:true},{id:'c',name:'丙',checkedIn:true}],2);
 const d=rosterDifference(local,cloud);
 assert.deepEqual([d.localCount,d.cloudCount,d.onlyCloud.names,d.onlyLocal.names,d.checkin.names],[2,2,['丙'],['乙'],['甲']]);
 assert.deepEqual(d.revisions,[{field:'registrationRosterRevision',local:1,cloud:2}]);
 assert.equal(rosterDifference(local,structuredClone(local)),null);
});
test('server draw rejection reads cloud roster and explains differences without resubmitting',async()=>{
 let local=state([{id:'a',name:'甲',checkedIn:true}],1),sendCount=0,applied=0;
 const cloud=state([{id:'a',name:'甲',checkedIn:true},{id:'b',name:'乙',checkedIn:true}],2);
 const saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const c=createServer({key:'test',code:'BXH-TEST',roomId:'room-1',storage,current:()=>true,state:()=>local,
  operationId:()=> '00000000-0000-4000-8000-000000000001',send:async()=>{sendCount++;throw Object.assign(Error('roster-stale'),{code:'functions/failed-precondition',details:{reason:'registration-roster-stale'}});},
  read:async()=>({ok:true,data:cloud,publicData:cloud}),apply:x=>{local=x;applied++;},changed:()=>{},success:()=>{throw Error('unexpected success');}});
 assert.equal(await c.begin(),false);
 assert.equal(sendCount,1);assert.equal(applied,1);
 assert.equal(c.status().pending,false);
 assert.equal(c.status().difference.onlyCloud.names[0],'乙');
 assert.equal(c.status().error,'registration-roster-stale');
});
