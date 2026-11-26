'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createApi}=require('./api.cjs');
function fixture(version=3){
 const code='BXH-ABC123',base='tournaments/'+code;
 const room={registrationFlowVersion:version,visibility:'public',tournamentPhase:'waiting',data:JSON.stringify({meta:{},players:[],matches:[]})};
 const data=new Map([[base,room],[base+'/registrationV3State/ledger',{capacity:8,occupiedCount:3,pendingReviewCount:3,confirmedCount:0,sequence:3,revision:3}],['users/admin',{active:true,role:'admin'}]]);
 for(let i=1;i<=3;i++){
  data.set('users/p'+i,{active:true,role:'player',realName:'Name '+i,phone:'secret'});
  data.set(base+'/registrationV3Holds/p'+i,{uid:'p'+i,sequence:i,status:'pending_review',submittedAt:i,updatedAt:i,attemptId:'attempt'+i});
 }
 const ref=path=>({path,collection:n=>ref(path+'/'+n),doc:n=>ref(path+'/'+n),
  where(k,op,v){return Object.assign(this,{filters:[...(this.filters||[]),[k,op,v]]});},
  orderBy(){return this;},limit(n){this.max=n;return this;}});
 const snap=path=>({exists:data.has(path),data:()=>data.get(path)});
 const db={doc:ref,runTransaction:fn=>fn({getAll:async(...refs)=>refs.map(r=>snap(r.path)),get:async r=>{
  const docs=[...data.keys()].filter(k=>k.startsWith(r.path+'/')).map(snap).filter(s=>r.filters.every(([k,op,v])=>op==='=='?s.data()[k]===v:s.data()[k]>v)).slice(0,r.max);
  return {docs};
 }})};
 const api=createApi({db});
 return (uid,action,params={})=>api({auth:{uid},data:{code,action,...params}});
}
test('player mine contains only own lightweight status',async()=>{
 const api=fixture();
 const x=await api('p1','mine',{registrationId:'p2'});
 assert.equal(x.hold.sequence,1);
 assert.equal('uid' in x.hold,false);
 assert.equal('phone' in x.hold,false);
 await assert.rejects(api('p1','reviewPage'),/permission-denied/);
});
test('review page is bounded and ordered, returns names only for selected page',async()=>{
 const api=fixture();
 const first=await api('admin','reviewPage',{limit:2});
 assert.deepEqual(first.rows.map(r=>r.uid),['p1','p2']);
 assert.equal(first.nextSequence,2);
 assert.equal(first.rows[0].displayName,'Name 1');
 assert.equal('phone' in first.rows[0],false);
 const second=await api('admin','reviewPage',{limit:2,afterSequence:first.nextSequence});
 assert.deepEqual(second.rows.map(r=>r.uid),['p3']);
 assert.equal(second.nextSequence,null);
 await assert.rejects(api('admin','reviewPage',{limit:31}),/invalid-limit/);
});
test('legacy rooms do not use V3 query routes',async()=>{
 for(const v of [1,2])await assert.rejects(fixture(v)('p1','mine'),/registration-v3-required/);
});
