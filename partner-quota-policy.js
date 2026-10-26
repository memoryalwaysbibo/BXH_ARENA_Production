/* Policy-aware room preparation. Grants and policies are issued by the server. */
(function(root){
  const LEGACY='creation-v1',START='start-v1';
  function fail(code){throw Object.assign(new Error(code),{code});}
  function policy(raw){if(raw==null)return LEGACY;if(raw!==LEGACY&&raw!==START)fail('unknown-partner-quota-policy');return raw;}
  function creationPlan({grant,contract,uid,now=Date.now()}={}){
    if(!grant||grant.scope!=='contract'||grant.status!=='active'||!contract||contract.status!=='active'||contract.targetUid!==uid||contract.orderCode!==grant.orderCode||contract.organizationCode!==grant.organizationId)fail('partner-contract-mismatch');
    const selected=policy(contract.quotaPolicy);
    if(selected!==policy(grant.quotaPolicy))fail('partner-quota-policy-mismatch');
    const start=Date.parse(contract.startsAt),end=Date.parse(contract.expiresAt);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end<=start)fail('partner-contract-period-invalid');
    if(!Number.isSafeInteger(contract.includedEvents)||contract.includedEvents<1||!Number.isSafeInteger(contract.usedEvents)||contract.usedEvents<0||contract.usedEvents>contract.includedEvents)fail('partner-quota-reconciliation-required');
    if(contract.usedEvents===contract.includedEvents)fail('partner-room-quota-exhausted');
    if(selected===START&&(contract.quotaPolicyVersion!==1||grant.quotaPolicyVersion!==1))fail('partner-quota-policy-mismatch');
    const fields=selected===START?{partnerQuotaPolicy:START,partnerStartState:'draft'}:{};
    return {policy:selected,debitOnCreate:selected===LEGACY,privateFields:{...fields},publicFields:{...fields}};
  }
  function restoreState(state,top,{publicView=false}={}){
    if(top?.partnerQuotaPolicy!==START)return state;
    if(!state||!top||!['draft','started'].includes(top.partnerStartState))fail('partner-start-state-invalid');
    state.partnerQuotaPolicy=START;
    if(top.partnerStartState==='draft'){
      state.startedAt=null;state.rosterLocked=false;delete state.rdwStartMode;delete state.rdwSnapshotDigest;
    }else{
      if(!Number.isSafeInteger(top.partnerStartedAt)||top.partnerStartedAt<=0||!/^[a-f0-9]{64}$/.test(top.rdwSnapshotDigest||'')||(!publicView&&(top.partnerQuotaDebit?.source!=='server'||top.partnerQuotaDebit?.snapshotDigest!==top.rdwSnapshotDigest)))fail('partner-start-proof-invalid');
      state.startedAt=top.partnerStartedAt;state.rosterLocked=true;state.rdwStartMode='rdw-verified';state.rdwSnapshotDigest=top.rdwSnapshotDigest;
    }
    return state;
  }
  function assertRuntimeWrite(state,top){
    if(top?.partnerQuotaPolicy!==START)return;
    const canonical=restoreState({},top);
    if(state?.partnerQuotaPolicy!==START||state.startedAt!==canonical.startedAt||state.rosterLocked!==canonical.rosterLocked||(state.rdwSnapshotDigest||null)!==(canonical.rdwSnapshotDigest||null)||(state.rdwStartMode||null)!==(canonical.rdwStartMode||null))fail('partner-server-start-required');
  }
  const api={LEGACY,START,policy,creationPlan,restoreState,assertRuntimeWrite};
  root.BXHPartnerQuota=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
