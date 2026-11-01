(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();else root.BXHFourCourtAppBridge=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const actions=new Set(['score','fault','undo','rematch','pause','resume','confirm','quick']);
 function create({client,code,uid,getUid,legacy={},timeoutMs=8000}){
  let view=client.getView(),closed=false,lastSignature=null;const states=new Set(),seats=new Set(),waiters=new Set();
  const current=()=>!closed&&getUid()===uid;
  const ready=()=>current()&&view.status==='ready'&&view.state?.cloudCode===code;
  function publish(next){
   if(closed)return;view=next;
   if(ready()){
    const signature=JSON.stringify(view.state);
    if(signature!==lastSignature){lastSignature=signature;for(const callback of states)callback(clone(view.state),true);for(const callback of seats)callback({model:clone(view.state.meta.refereeSeatsV1),projection:clone(view.state.meta)});}
   }else lastSignature=null;
   for(const check of [...waiters])check();
  }
  async function commit(data){
   if(!current()||data.code!==code)return {ok:false,reason:'bucket-session-mismatch'};
   if(!actions.has(data.action))return {ok:false,reason:'unsupported-bucket-action'};
   if(!ready())return {ok:false,reason:'not-synchronized'};
   const result=await client.score(data.matchId,data.action,data);
   if(!result?.ok)return result;
   const confirmed=()=>ready()&&Number(view.state.matches.find(m=>m.id===data.matchId)?.refereeSeatScoreRevision||0)>=Number(result.scoreRevision);
   if(!confirmed())await new Promise(resolve=>{
    let timer;const check=()=>{if(confirmed()||!current()||view.status==='error'||view.status==='offline'){clearTimeout(timer);waiters.delete(check);resolve();}};
    timer=setTimeout(()=>{waiters.delete(check);resolve();},timeoutMs);waiters.add(check);check();
   });
   if(!confirmed())return {ok:false,reason:'not-synchronized'};
   return {...result,state:clone(view.state)};
  }
  const cloud={...legacy,
   commitRefereeCommand:commit,
   manageRefereeSeats:data=>current()&&data.code===code?client.manageRefereeSeats(data):Promise.resolve({ok:false,reason:'bucket-session-mismatch'}),
   joinRoom:async requested=>requested===code&&ready()?{ok:true,data:clone(view.state)}:{ok:false,reason:'not-synchronized'},
   subscribe(requested,callback){if(requested!==code||!current())return ()=>{};states.add(callback);if(ready())queueMicrotask(()=>{if(states.has(callback)&&ready())callback(clone(view.state),true);});return ()=>states.delete(callback);},
   subscribeRefereeSeats(requested,callback){if(requested!==code||!current())return ()=>{};seats.add(callback);if(ready())queueMicrotask(()=>{if(seats.has(callback)&&ready())callback({model:clone(view.state.meta.refereeSeatsV1),projection:clone(view.state.meta)});});return ()=>seats.delete(callback);}
  };
  return {cloud,publish,close(){closed=true;states.clear();seats.clear();for(const check of [...waiters])check();}};
 }
 return {create};
});
