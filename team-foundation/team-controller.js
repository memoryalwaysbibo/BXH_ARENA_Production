(function(root){
'use strict';
// Transport is deliberately injected; no unverified production endpoint is assumed.
function createTeamController({api,onChange=()=>{},newRequestId=()=>{if(!root.crypto?.randomUUID)throw Error('secure-id-unavailable');return root.crypto.randomUUID();}}){
 if(!api||!['list','members','command','mine'].every(k=>typeof api[k]==='function'))throw Error('team-api-required');
 const state={screen:'lobby',items:[],total:0,query:{},team:null,partial:false,staleCount:0,totalIsUpperBound:false,loading:false,busy:false,error:null,pending:false};
 let generation=0,disposed=false,pendingPayload=null;
 const snapshot=()=>structuredClone(state);
 const emit=()=>{if(!disposed)onChange(snapshot());};
 async function load(screen,payload){
  if(disposed)return {ok:false,reason:'disposed'};
  const ticket=++generation;state.screen=screen;state.loading=true;state.error=null;state.team=null;state.items=[];state.total=0;state.partial=false;state.staleCount=0;state.totalIsUpperBound=false;emit();
  try{
   const result=await(screen==='members'?api.members(payload):(screen==='mine'||screen==='create')?api.mine():api.list(payload));
   if(disposed||ticket!==generation)return {ok:false,reason:'superseded'};
   if(screen==='members')state.team=result;else if(screen==='mine'||screen==='create')state.team=result.team;else{
    if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0)throw Error('invalid-response');
    state.items=result.items;state.total=result.total;state.partial=result.partial===true;state.totalIsUpperBound=result.totalIsUpperBound===true;state.staleCount=Number.isSafeInteger(result.staleCount)?result.staleCount:0;
   }
   return {ok:true};
  }catch(_){if(!disposed&&ticket===generation)state.error='資料暫時無法載入，請重試。';return {ok:false,reason:'load-failed'};}
  finally{if(!disposed&&ticket===generation){state.loading=false;emit();}}
 }
 async function search(query={}){state.query=structuredClone(query);return load('lobby',state.query);}
 async function send(payload){
  const requestGeneration=generation;
  state.busy=true;state.error=null;emit();
  try{
   const result=await api.command(payload);
   if(result?.ok!==true)throw Error('command-failed');
   pendingPayload=null;state.pending=false;
   if(!disposed&&generation===requestGeneration){if(payload.action==='admission'||payload.action==='create')await load('mine',{});else await search(state.query);}
   return {ok:true};
  }catch(_){
   if(!disposed){pendingPayload=payload;state.pending=true;state.error='操作結果尚未確認，可重試同一筆操作。';emit();}
   return {ok:false,reason:'unconfirmed'};
  }finally{if(!disposed){state.busy=false;emit();}}
 }
 async function operate(action,teamId,extra={}){
  if(disposed||state.busy||state.loading)return {ok:false,reason:'busy'};
  if(pendingPayload)return {ok:false,reason:'pending-confirmation'};
  if(!['join','apply','cancel','leave','remove','admission','create'].includes(action))return {ok:false,reason:'invalid-action'};
  let requestId;try{requestId=newRequestId();}catch(_){state.error='目前無法安全執行操作，請重新載入再試。';emit();return {ok:false,reason:'secure-id-unavailable'};}
  const payload={action:action==='join'?'apply':action,teamId,requestId};
  if(action==='admission')payload.policy=structuredClone(extra.policy);
  if(action==='create')payload.name=extra.name;
  if(action==='remove'){payload.targetUid=extra.targetUid;payload.reasonCode=extra.reasonCode;payload.reasonNote=extra.reasonNote;}
  return send(payload);
 }
 async function retryPending(){
  if(disposed||state.busy||state.loading)return {ok:false,reason:'busy'};
  if(!pendingPayload)return {ok:false,reason:'no-pending-operation'};
  return send(pendingPayload);
 }

 return {snapshot,search,mine:()=>load('mine',{}),create:()=>load('create',{}),clear:()=>search({}),view:teamId=>load('members',{teamId}),operate,retryPending,dispose:()=>{disposed=true;generation++;}};
}
if(typeof module==='object'&&module.exports)module.exports={createTeamController};else root.BXHTeamController={createTeamController};
})(typeof window==='object'?window:globalThis);
