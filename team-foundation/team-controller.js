(function(root){
'use strict';
// Transport is deliberately injected; no unverified production endpoint is assumed.
function createTeamController({api,onChange=()=>{}}){
 if(!api||!['list','members','command'].every(k=>typeof api[k]==='function'))throw Error('team-api-required');
 const state={screen:'lobby',items:[],total:0,query:{},team:null,loading:false,busy:false,error:null};
 let generation=0,disposed=false;
 const snapshot=()=>structuredClone(state);
 const emit=()=>{if(!disposed)onChange(snapshot());};
 async function load(screen,payload){
  if(disposed)return {ok:false,reason:'disposed'};
  const ticket=++generation;state.screen=screen;state.loading=true;state.error=null;state.team=null;state.items=[];state.total=0;emit();
  try{
   const result=await(screen==='members'?api.members(payload):api.list(payload));
   if(disposed||ticket!==generation)return {ok:false,reason:'superseded'};
   if(screen==='members')state.team=result;else{
    if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0)throw Error('invalid-response');
    state.items=result.items;state.total=result.total;
   }
   return {ok:true};
  }catch(_){if(!disposed&&ticket===generation)state.error='資料暫時無法載入，請重試。';return {ok:false,reason:'load-failed'};}
  finally{if(!disposed&&ticket===generation){state.loading=false;emit();}}
 }
 async function search(query={}){state.query=structuredClone(query);return load('lobby',state.query);}
 async function operate(action,teamId,extra={}){
  if(disposed||state.busy||state.loading)return {ok:false,reason:'busy'};
  if(!['join','apply','cancel','leave','remove'].includes(action))return {ok:false,reason:'invalid-action'};
  const requestGeneration=generation;
  state.busy=true;state.error=null;emit();
  try{
   // Identity and eligibility must be derived by server; never sent as trusted fields.
   const payload={action:action==='join'?'apply':action,teamId};
   if(action==='remove'){payload.targetUid=extra.targetUid;payload.reasonCode=extra.reasonCode;payload.reasonNote=extra.reasonNote;}
   const result=await api.command(payload);
   if(result?.ok!==true)throw Error('command-failed');
   if(!disposed&&generation===requestGeneration)await search(state.query);
   return {ok:true};
  }catch(_){if(!disposed&&generation===requestGeneration){state.error='操作結果尚未確認，請重新整理確認成員狀態。';emit();}return {ok:false,reason:'unconfirmed'};}
  finally{if(!disposed){state.busy=false;emit();}}
 }
 return {snapshot,search,clear:()=>search({}),view:teamId=>load('members',{teamId}),operate,dispose:()=>{disposed=true;generation++;}};
}
if(typeof module==='object'&&module.exports)module.exports={createTeamController};else root.BXHTeamController={createTeamController};
})(typeof window==='object'?window:globalThis);
