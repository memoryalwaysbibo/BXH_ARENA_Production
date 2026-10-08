// Client-side recovery does not grant permission; every command remains server-validated.
export function createController({transport,storage=null,onChange=()=>{},clock=Date.now,requestId=()=>crypto.randomUUID()}){
  let uid=null,epoch=0,snapshot=null,pending=null,busy=false,abort=null,backgroundAbort=null;
  const key=id=>'arena-pk:pending:'+id;
  const state=()=>({uid,snapshot:structuredClone(snapshot),pending:structuredClone(pending),busy});
  const publish=()=>onChange(state());
  function persist(){if(!storage||!uid)return;try{if(pending)storage.setItem(key(uid),JSON.stringify(pending));else storage.removeItem(key(uid));}catch{/* Current-session retry remains available if storage is full. */}}
  function setSession(nextUid){
    abort?.abort();backgroundAbort?.abort();backgroundAbort=null;epoch++;if(uid&&uid!==nextUid){try{storage?.removeItem(key(uid));}catch{}}
    uid=nextUid;snapshot=null;pending=null;busy=false;abort=null;
    if(uid&&storage){try{const saved=JSON.parse(storage.getItem(key(uid))||'null');
      if(saved?.schemaVersion===1&&saved.uid===uid&&Number.isSafeInteger(saved.savedAt)&&clock()>=saved.savedAt&&clock()-saved.savedAt<600000&&typeof saved.operation==='string'&&saved.input?.requestId)pending=saved;
      else storage.removeItem(key(uid));
    }catch{try{storage.removeItem(key(uid));}catch{}}}
    publish();
  }
  async function sync(challengeId){
    if(!uid||busy||pending||backgroundAbort)return null;
    const generation=epoch,signalController=new AbortController();backgroundAbort=signalController;
    try{
      const result=await transport('getChallenge',{challengeId},{uid,signal:signalController.signal});
      if(generation!==epoch||busy||pending)return null;
      if(!snapshot||(snapshot.challengeId===result.challenge.challengeId&&result.challenge.revision>snapshot.revision)){
        snapshot=result.challenge;publish();
      }
      return result;
    }finally{if(backgroundAbort===signalController)backgroundAbort=null;}
  }
  async function read(challengeId){
    if(!uid||busy)throw Error('session-unavailable');const generation=epoch;abort=new AbortController();busy=true;publish();
    try{const result=await transport('getChallenge',{challengeId},{uid,signal:abort.signal});if(generation!==epoch)return null;snapshot=result.challenge;return result;}
    finally{if(generation===epoch){busy=false;abort=null;publish();}}
  }
  async function retry(){
    if(!uid||busy||!pending)throw Error('pending-unavailable');
    const generation=epoch,command=structuredClone(pending);abort=new AbortController();busy=true;publish();
    try{const result=await transport(command.operation,command.input,{uid,signal:abort.signal});
      if(generation!==epoch)return null;snapshot=result.challenge;pending=null;persist();return result;
    }catch(error){if(generation===epoch&&error.definitive===true){pending=null;persist();}throw error;}
    finally{if(generation===epoch){busy=false;abort=null;publish();}}
  }
  async function mutate(operation,input){
    if(!uid||busy)throw Error('session-unavailable');if(pending)throw Error('pending-unresolved');
    if(operation==='getChallenge')throw Error('read-operation-required');
    pending={schemaVersion:1,uid,operation,input:structuredClone({...input,requestId:requestId()}),savedAt:clock()};persist();publish();return retry();
  }
  function dispose({preservePending=false}={}){if(!preservePending){setSession(null);return;}abort?.abort();backgroundAbort?.abort();epoch++;uid=null;snapshot=null;pending=null;busy=false;abort=backgroundAbort=null;}
  return Object.freeze({setSession,read,sync,mutate,retry,dispose,state});
}
