(function(root){
'use strict';
// Firebase httpsCallable is injected by the host; identity/App Check come from its SDK.
function createTeamApi({functions,httpsCallable}){
 if(!functions||typeof httpsCallable!=='function')throw Error('firebase-functions-required');
 const read=httpsCallable(functions,'teamRead'),command=httpsCallable(functions,'teamCommand'),emblem=httpsCallable(functions,'teamEmblemUpload');
 async function call(fn,payload){const result=await fn(payload);if(!result||!result.data||typeof result.data!=='object')throw Error('invalid-callable-response');return result.data;}
 return {mine:()=>call(read,{action:'mine'}),list:query=>call(read,{action:'list',query}),members:({teamId})=>call(read,{action:'members',teamId}),applications:({teamId})=>call(read,{action:'applications',teamId}),history:({teamId,cursor})=>call(read,{action:'history',teamId,...(cursor?{cursor}:{})}),command:payload=>call(command,payload),uploadEmblem:payload=>call(emblem,payload)};
}
// Reuse ARENA's existing authenticated Callable bridge, including its session checks.
function createTeamApiFromEngagement({engagementService}){
 if(!engagementService||typeof engagementService.tournamentOperation!=='function')throw Error('engagement-service-required');
 const invoke=(name,payload)=>engagementService.tournamentOperation(name,payload);
 return {mine:()=>invoke('teamRead',{action:'mine'}),list:query=>invoke('teamRead',{action:'list',query}),members:({teamId})=>invoke('teamRead',{action:'members',teamId}),applications:({teamId})=>invoke('teamRead',{action:'applications',teamId}),history:({teamId,cursor})=>invoke('teamRead',{action:'history',teamId,...(cursor?{cursor}:{})}),command:payload=>invoke('teamCommand',payload),uploadEmblem:payload=>invoke('teamEmblemUpload',payload)};
}
if(typeof module==='object'&&module.exports)module.exports={createTeamApi,createTeamApiFromEngagement};else root.BXHTeamApi={createTeamApi,createTeamApiFromEngagement};
})(typeof window==='object'?window:globalThis);
