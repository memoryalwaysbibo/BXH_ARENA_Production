/* Complete a prepared family account transfer on the child's own signed-in session. */
(function(root){
  const pending=new Map();
  async function complete({uid,profile,claim,reload,isCurrent,timeoutMs=8000}){
    if(profile?.active!==true||profile?.familyTransferPending!==true||profile?.accountStatus!=="pending_family_transfer")return {profile,claimed:false};
    if(!uid||typeof claim!=="function"||typeof reload!=="function"||typeof isCurrent!=="function")return {profile,claimed:false,error:"service-unavailable"};
    let operation=pending.get(uid);
    if(!operation){
      operation=Promise.resolve().then(claim);
      pending.set(uid,operation);
      operation.then(()=>{if(pending.get(uid)===operation)pending.delete(uid);},()=>{if(pending.get(uid)===operation)pending.delete(uid);});
    }
    let timer;
    try{
      const result=await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("claim-timeout")),timeoutMs);})]);
      if(!isCurrent())return {profile,claimed:false};
      if(result?.ok!==true||!["completed","none"].includes(result.status))return {profile,claimed:false,error:"claim-rejected"};
      clearTimeout(timer);
      const fresh=await Promise.race([Promise.resolve().then(reload),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("claim-timeout")),timeoutMs);})]);
      if(!isCurrent())return {profile,claimed:false};
      if(fresh?.active!==true||fresh.familyTransferPending!==false||fresh.accountStatus!=="normal")return {profile,claimed:false,error:"claim-unconfirmed"};
      return {profile:fresh,claimed:result.status==="completed"};
    }catch(error){return {profile,claimed:false,error:error?.message==="claim-timeout"?"claim-timeout":"claim-failed"};}
    finally{clearTimeout(timer);}
  }
  root.BXHFamilyTransferClaim={complete};
})(typeof window!=="undefined"?window:globalThis);
