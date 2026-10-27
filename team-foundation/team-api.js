(function(root){
'use strict';
// Firebase httpsCallable is injected by the host; identity/App Check come from its SDK.
function createTeamApi({functions,httpsCallable}){
 if(!functions||typeof httpsCallable!=='function')throw Error('firebase-functions-required');
 const read=httpsCallable(functions,'teamRead'),command=httpsCallable(functions,'teamCommand');
 async function call(fn,payload){const result=await fn(payload);if(!result||!result.data||typeof result.data!=='object')throw Error('invalid-callable-response');return result.data;}
 return {list:query=>call(read,{action:'list',query}),members:({teamId})=>call(read,{action:'members',teamId}),command:payload=>call(command,payload)};
}
if(typeof module==='object'&&module.exports)module.exports={createTeamApi};else root.BXHTeamApi={createTeamApi};
})(typeof window==='object'?window:globalThis);
