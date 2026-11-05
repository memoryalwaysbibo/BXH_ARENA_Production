'use strict';
const assert=require('node:assert/strict');
const {createHandler}=require('./functions/service.cjs');
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
function harness(){
 const room={createdBy:'host',eventAuthority:'official',assignedStaffUids:['main','backup'],refereeStationAssignments:{},updatedAt:1,data:JSON.stringify({id:'r',cloudCode:'BXH-TEST',meta:{eventAuthority:'official',stations:1},matches:[{id:'m',scoreA:2,faultActions:[{side:'A'}]}]})};
 const docs=new Map([['tournaments/BXH-TEST',room],['publicTournaments/BXH-TEST',{bracketView:JSON.stringify({meta:{},matches:[{id:'m',scoreA:2}]})}],['systemConfig/refereeSeatsV1',{enabled:true,perCourtScoringVerified:true}],...['host','main','backup'].map(uid=>['users/'+uid,{active:true,role:'staff',realName:uid}])]);
 let tail=Promise.resolve(),seq=0,retryNext=false;
 const snapshot=path=>({id:path.split('/').at(-1),exists:docs.has(path),data:()=>clone(docs.get(path))});
 const ref=path=>({
  path,get:async()=>snapshot(path),
  update:async patch=>{assert(docs.has(path));docs.set(path,{...docs.get(path),...clone(patch)});},
  collection:name=>({
   doc:id=>ref(path+'/'+name+'/'+id),
   orderBy:()=>({limit:count=>({get:async()=>({docs:[...docs.keys()]
    .filter(k=>k.startsWith(path+'/'+name+'/'))
    .sort((a,b)=>docs.get(b).createdAt-docs.get(a).createdAt).slice(0,count).map(snapshot)})})})
  })
 });
 const db={doc:ref,collection:name=>({where:(field,operator,value)=>({limit:count=>({query:{name,field,value,count}})})}),runTransaction:fn=>{
  const result=tail.then(async()=>{
   const attempt=async()=>{const writes=[];const out=await fn({
    get:async r=>{
     if(!r.query)return snapshot(r.path);
     const q=r.query,rows=[...docs.keys()].filter(k=>k.startsWith(q.name+'/')&&k.split('/').length===2&&docs.get(k)[q.field]===q.value).slice(0,q.count).map(snapshot);
     return {size:rows.length,docs:rows};
    },
    update:(r,patch)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...clone(patch)})),
    set:(r,data)=>writes.push(()=>docs.set(r.path,{...docs.get(r.path),...clone(data)})),
    create:(r,data)=>writes.push(()=>{assert(!docs.has(r.path));docs.set(r.path,clone(data));})
   });return {writes,out};};
   if(retryNext){retryNext=false;await attempt();}
   const {writes,out}=await attempt();writes.forEach(w=>w());return out;
  });tail=result.catch(()=>{});return result;
 }};
 let now=1000;
 const handle=createHandler(db,{clock:()=>now,uuid:()=> 'request-'+(++seq)});
 let opSeq=0;
 const run=(uid,action,args={})=>handle({auth:{uid},data:{code:'BXH-TEST',operationId:'operation-number-'+(++opSeq),action,...args}});
 const doc=()=>docs.get('tournaments/BXH-TEST');
 return {docs,handle,run,doc,advance:ms=>{now+=ms;},retry:()=>{retryNext=true;}};
}
function communityFixture(){
 const h=harness(),room=h.doc(),state=JSON.parse(room.data);
 Object.assign(room,{eventAuthority:'community',ladderMode:'general',ownerUid:'host',assignedStaffUids:[]});
 Object.assign(state.meta,{eventAuthority:'community',ladderMode:'general',stations:2});room.data=JSON.stringify(state);
 for(const uid of ['host','main','backup'])h.docs.get('users/'+uid).role='player';
 h.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 return h;
}

module.exports={harness,communityFixture,clone};
