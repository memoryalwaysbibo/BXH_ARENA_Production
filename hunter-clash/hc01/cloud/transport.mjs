import{ENDPOINT,validateConfig}from'./config.mjs';
const reasons=new Set(['invalid-operation','invalid-id','invalid-input','invalid-rules','invalid-pairing-policy','invalid-time','unauthenticated','account-unavailable','opponent-unavailable','challenge-unavailable','participant-required','closed','request-id-reused','challenge-already-exists','pairing-rate-limited','pairing-unavailable','revision-conflict','terminal-state','invalid-state','invalid-round','round-confirmation-invalid','finish-confirmation-invalid','environment-mismatch','revision-overflow']);
export function createCloudTransport({config,origin,auth,getAppCheckToken,fetcher=fetch}){
  validateConfig(config,origin);
  return async(operation,input,{uid,signal})=>{
    const user=auth.currentUser;
    if(!user||user.uid!==uid)throw Error('session-unavailable');
    const token=await user.getIdToken();const appCheck=await getAppCheckToken();
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(auth.currentUser?.uid!==uid)throw Error('session-unavailable');
    if(typeof token!=='string'||!token||typeof appCheck?.token!=='string'||!appCheck.token)throw Error('credentials-unavailable');
    let timeout;const controller=new AbortController();const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
    try{
      timeout=setTimeout(cancel,45000);
      const response=await fetcher(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Firebase-AppCheck':appCheck.token},
        credentials:'omit',cache:'no-store',body:JSON.stringify({data:{operation,input}}),signal:controller.signal});
      const body=await response.json();
      if(body.error){const reason=body.error.details?.reason;const error=Error(reasons.has(reason)?reason:'request-rejected');
        // An INTERNAL/unknown transport error may follow a committed transaction. Keep the pending command.
        error.definitive=response.status>=400&&response.status<500&&reasons.has(reason);throw error;}
      const result=body.result;
      if(!response.ok||result?.challenge?.environment!=='sandbox'||typeof result.challenge.challengeId!=='string'||!result.challenge.participants.includes(uid))throw Error('unknown-response');
      return result;
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
  };
}
