(function(root){
'use strict';
// Transport is deliberately injected; no unverified production endpoint is assumed.
function createTeamController({api,emblems=root.BXHTeamEmblem,onChange=()=>{},newRequestId=()=>{if(!root.crypto?.randomUUID)throw Error('secure-id-unavailable');return root.crypto.randomUUID();}}){
 if(!api||!['list','members','command','mine','applications','history'].every(k=>typeof api[k]==='function'))throw Error('team-api-required');
 const state={screen:'lobby',items:[],total:0,query:{},team:null,partial:false,staleCount:0,totalIsUpperBound:false,loading:false,loaded:false,busy:false,error:null,pending:false,applicationsTeamId:null,managementTeamId:null,historyTeamId:null,historyNextCursor:null,historyPage:1,hasMore:false};
 let generation=0,disposed=false,pendingPayload=null,historyCursors=[null];
 // Only known server rejections prove the transaction did not commit.
 const rejectionMessages={
  'already-in-team':'你已有戰隊，請先確認目前的戰隊。',
  'team-id-taken':'戰隊資料已存在，請重新整理後確認。',
  'team-not-found':'找不到這支戰隊，請重新整理。',
  'team-dissolved':'這支戰隊已解散。',
  'team-full':'戰隊已滿員。',
  'ladder-tier-below-minimum':'未達戰隊設定的天梯排位條件。',
  'tier-below-minimum':'未達戰隊設定的獵人排位條件。',
  'captain-required':'此操作需要隊長權限。',
  'leadership-required':'此操作需要隊長或副隊長權限。',
  'not-member':'你目前不是這支戰隊的成員。',
  'transfer-captain-first':'請先轉移隊長職位。',
  'team-must-be-solo':'解散前戰隊必須只剩隊長。',
  'application-not-pending':'這筆申請已不在待審核狀態。',
  'role-full':'此職位名額已滿。',
  'frame-locked':'尚未解鎖此戰隊框。',
  'invalid-emblem':'圖片格式或大小不符合要求。',
  'emblem-expired':'這筆圖片上傳已逾期，請重新選擇圖片再上傳。',
  'invalid-request':'上傳資料有誤，請重新選擇圖片。',
  'operation-id-conflict':'這筆上傳與先前的操作不一致，請重新選擇圖片。',
  'account-disabled':'帳號無法使用此功能。',
  'sign-in-required':'請先登入。',
  'sign-in-again':'登入已過期，請重新登入。',
  'teams-unavailable':'戰隊功能目前尚未開放。'
 };
 function rejectionMessage(error){
  const raw=String(error?.message||''),code=String(error?.code||'');
  return code&&raw.endsWith(' '+code)?raw.slice(0,-code.length-1):raw;
 }
 function rejection(error){
  const code=String(error?.code||'').replace(/^functions\//,'');
  const message=rejectionMessage(error);
  return ['invalid-argument','failed-precondition','permission-denied','unauthenticated'].includes(code)&&Object.hasOwn(rejectionMessages,message)?rejectionMessages[message]:null;
 }
 const snapshot=()=>structuredClone(state);
 const emit=()=>{if(!disposed)onChange(snapshot());};
 async function loadEmblem(teamId,ticket){
  if(typeof api.emblem!=='function')return;
  try{const result=await api.emblem({teamId}),image=result?.image;
   if(disposed||ticket!==generation||state.team?.id!==teamId)return;
   const base64=image?.base64;
   if(image?.contentType!=='image/webp'||typeof base64!=='string'||base64.length<16||base64.length>174764||!/^UklGR[A-Za-z0-9+/]*(?:={0,2})$/.test(base64))return;
   state.team.emblemSource='data:image/webp;base64,'+base64;emit();
  }catch(_){/* Image failure never removes an otherwise available team page. */}
 }
 async function loadLobbyEmblems(ticket){
  if(typeof api.emblem!=='function'||typeof emblems?.hydrate!=='function'||!state.items.some(x=>x.hasEmblem===true))return;
  const isCurrent=()=>!disposed&&ticket===generation;const result=await emblems.hydrate({items:state.items,read:p=>api.emblem(p),isCurrent});
  if(isCurrent()){state.items=result;emit();}
 }
 async function load(screen,payload){
  if(disposed)return {ok:false,reason:'disposed'};
  const ticket=++generation;if(screen==='manage')state.managementTeamId=payload.teamId;if(screen==='applications')state.applicationsTeamId=payload.teamId;if(screen==='history')state.historyTeamId=payload.teamId;state.screen=screen;state.loading=true;state.loaded=false;state.error=null;state.team=null;state.items=[];state.total=0;state.partial=false;state.staleCount=0;state.totalIsUpperBound=false;emit();
  try{
   const result=screen==='manage'?await (async()=>{const own=await api.mine();if(own.team?.id!==payload.teamId||!['captain','deputy'].includes(own.team.role))throw Error('leadership-required');const members=await api.members(payload);return {...members,viewerRole:own.team.role};})():await(screen==='applications'?api.applications(payload):screen==='history'?api.history(payload):screen==='members'?api.members(payload):(screen==='mine'||screen==='create')?api.mine():api.list(payload));
   if(disposed||ticket!==generation)return {ok:false,reason:'superseded'};
   if(screen==='manage')state.team=result;else if(screen==='history'){if(!Array.isArray(result.items))throw Error('invalid-response');state.items=result.items;state.historyNextCursor=typeof result.nextCursor==='string'?result.nextCursor:null;}else if(screen==='applications'){if(!Array.isArray(result.items))throw Error('invalid-response');state.items=result.items;state.hasMore=result.hasMore===true;state.applicationsTeamId=payload.teamId;}else if(screen==='members')state.team=result;else if(screen==='mine'||screen==='create')state.team=result.team;else{
    if(!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0)throw Error('invalid-response');
    state.items=result.items;state.total=result.total;state.partial=result.partial===true;state.totalIsUpperBound=result.totalIsUpperBound===true;state.staleCount=Number.isSafeInteger(result.staleCount)?result.staleCount:0;
   }
   state.loaded=true;if(['mine','members'].includes(screen)&&state.team?.id)void loadEmblem(state.team.id,ticket);if(screen==='lobby')void loadLobbyEmblems(ticket);return {ok:true};
  }catch(_){if(!disposed&&ticket===generation)state.error='資料暫時無法載入，請重試。';return {ok:false,reason:'load-failed'};}
  finally{if(!disposed&&ticket===generation){state.loading=false;emit();}}
 }
 async function historyStart(teamId){
  if(disposed||state.loading)return {ok:false,reason:'busy'};
  const result=await load('history',{teamId});
  if(result.ok){historyCursors=[null];state.historyPage=1;emit();}
  return result;
 }
 async function historyNext(){
  if(disposed||state.loading||state.screen!=='history'||!state.loaded||!state.historyNextCursor)return {ok:false,reason:'unavailable'};
  const cursor=state.historyNextCursor,result=await load('history',{teamId:state.historyTeamId,cursor});
  if(result.ok){historyCursors.push(cursor);state.historyPage=historyCursors.length;emit();}
  return result;
 }
 async function historyPrevious(){
  if(disposed||state.loading||state.screen!=='history'||!state.loaded||historyCursors.length<2)return {ok:false,reason:'unavailable'};
  const cursor=historyCursors[historyCursors.length-2],result=await load('history',{teamId:state.historyTeamId,...(cursor?{cursor}:{})});
  if(result.ok){historyCursors.pop();state.historyPage=historyCursors.length;emit();}
  return result;
 }
 async function search(query={}){state.query=structuredClone(query);return load('lobby',state.query);}
 async function send(payload){
  const requestGeneration=generation;
  state.busy=true;state.error=null;emit();
  try{
   const {action,...emblemPayload}=payload;
   const result=action==='emblem'?await api.uploadEmblem(emblemPayload):await api.command(payload);
   if(result?.ok!==true)throw Error('command-failed');
   pendingPayload=null;state.pending=false;
   if(!disposed&&generation===requestGeneration){if(payload.action==='remove'||payload.action==='assign')await load('manage',{teamId:payload.teamId});else if(payload.action==='approve'||payload.action==='reject')await load('applications',{teamId:payload.teamId});else if(payload.action==='admission'||payload.action==='frame'||payload.action==='emblem'||payload.action==='create'||payload.action==='transfer'||payload.action==='leave'||payload.action==='dissolve')await load('mine',{});else await search(state.query);}
   return {ok:true};
  }catch(error){
   let rejected=rejection(error);
   if(payload.action==='approve'&&rejectionMessage(error)==='already-in-team'&&rejected)rejected='申請者已有戰隊，無法核准加入。';
   if(!disposed){pendingPayload=rejected?null:payload;state.pending=!rejected;state.error=rejected||'操作結果尚未確認，可重試同一筆操作。';emit();}
   return {ok:false,reason:rejected?'rejected':'unconfirmed'};
  }finally{if(!disposed){state.busy=false;emit();}}
 }
 async function operate(action,teamId,extra={}){
  if(disposed||state.busy||state.loading)return {ok:false,reason:'busy'};
  if(pendingPayload)return {ok:false,reason:'pending-confirmation'};
  if(!['join','apply','cancel','leave','remove','admission','frame','emblem','create','approve','reject','assign','transfer','dissolve'].includes(action))return {ok:false,reason:'invalid-action'};
  if(action==='emblem'&&(typeof api.uploadEmblem!=='function'||typeof extra.base64!=='string'||!extra.base64||extra.base64.length>174764))return {ok:false,reason:'invalid-emblem'};
  let requestId;try{requestId=newRequestId();}catch(_){state.error='目前無法安全執行操作，請重新載入再試。';emit();return {ok:false,reason:'secure-id-unavailable'};}
  const payload={action:action==='join'?'apply':action,teamId,requestId};
  if(action==='admission')payload.policy=structuredClone(extra.policy);
  if(action==='frame')payload.frame=extra.frame;
  if(action==='emblem'){payload.contentType='image/webp';payload.base64=extra.base64;}
  if(action==='create')payload.name=extra.name;
  if(action==='approve'||action==='reject')payload.targetUid=extra.targetUid;
  if(action==='assign'){payload.targetUid=extra.targetUid;payload.role=extra.role;}
  if(action==='transfer')payload.targetUid=extra.targetUid;
  if(action==='remove'){payload.targetUid=extra.targetUid;payload.reasonCode=extra.reasonCode;payload.reasonNote=extra.reasonNote;}
  return send(payload);
 }
 async function retryPending(){
  if(disposed||state.busy||state.loading)return {ok:false,reason:'busy'};
  if(!pendingPayload)return {ok:false,reason:'no-pending-operation'};
  return send(pendingPayload);
 }

 return {snapshot,search,mine:()=>load('mine',{}),create:()=>load('create',{}),clear:()=>search({}),view:teamId=>load('members',{teamId}),applications:teamId=>load('applications',{teamId}),manage:teamId=>load('manage',{teamId}),history:historyStart,historyNext,historyPrevious,operate,retryPending,dispose:()=>{disposed=true;generation++;}};
}
if(typeof module==='object'&&module.exports)module.exports={createTeamController};else root.BXHTeamController={createTeamController};
})(typeof window==='object'?window:globalThis);
