(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function signature(s={}){
 return JSON.stringify([s.drawnAt||null,s.bracketSize||0,s.meta?.formatType||'single',s.meta?.battleMode||'individual',
  (s.matches||[]).map(m=>[m.id,m.bracket,m.round,m.indexInRound,m.a?.playerId||null,m.b?.playerId||null,m.teamIds||null]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
function assertWrite(remote,incoming,options={}){
 const same=remote.bracketDraw?.id&&remote.bracketDraw.id===incoming.bracketDraw?.id;
 if(options.bracketCommit){
  if(same){if(signature(remote)!==signature(incoming))throw Error('bracket-version-conflict');return 'already-committed';}
  if(remote.startedAt||remote.archiveStatus==='completed')throw Error('bracket-started');
  if(signature(remote)!==options.bracketCommit.baseSignature)throw Error('bracket-version-conflict');
  if(!incoming.bracketDraw?.id||incoming.startedAt)throw Error('invalid-bracket-commit');
 }else if(remote.bracketDraw?.id&&!same)throw Error('bracket-version-conflict');
 if(remote.startedAt&&!incoming.startedAt)throw Error('bracket-started');
 if(!remote.startedAt&&incoming.startedAt&&options.bracketStartSignature!==signature(remote))throw Error('bracket-version-conflict');
 return 'write';
}
function create(ctx){
 let busy=false,pending=null,error='',result='';
 const key='bxh-bracket-pending-v1:'+ctx.key;
 try{const saved=JSON.parse(ctx.storage?.getItem(key)||'null');if(saved?.snapshot?.bracketDraw?.id&&saved.baseSignature){pending=saved;result='failed';error='pending-upload-unconfirmed';}}catch{}
 function keep(){if(pending){if(!ctx.storage)throw Error('pending-storage-unavailable');ctx.storage.setItem(key,JSON.stringify(pending));}else ctx.storage?.removeItem(key);}
 const deadline=(p,budget=Infinity)=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('confirmation-timeout')),Math.min(ctx.timeoutMs||20000,budget));p.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
 function matches(result,snapshot){return (!pending?.adminOperationalOverride||result?.data?.adminOperationOverrides?.some(r=>r.id===pending.adminOperationalOverride.id))&&result?.ok===true&&signature(result.data)===signature(snapshot)&&signature(result.publicData)===signature(snapshot)&&result.data.bracketDraw?.id===snapshot.bracketDraw?.id;}
 async function retry(){
  if(busy||!pending||!ctx.current())return false;
  busy=true;error='';result='';
  const feedback=new Promise(resolve=>setTimeout(resolve,ctx.minimumFeedbackMs??(ctx.cloud()?2000:0)));
  ctx.changed();
  try{
   keep();
   if(ctx.cloud()){
    const expires=Date.now()+(ctx.totalTimeoutMs??25000);
    const run=fn=>{const remaining=expires-Date.now();if(remaining<=0)throw Error('confirmation-timeout');return deadline(fn(),remaining);};
    const pause=async attempt=>{await new Promise(resolve=>setTimeout(resolve,(ctx.confirmationDelayMs??500)*attempt));if(!ctx.current())throw Error('stale-context');};
    const competing=latest=>latest?.ok===true&&!matches(latest,pending.snapshot)&&
     latest.data.bracketDraw?.id!==pending.snapshot.bracketDraw.id&&
     (signature(latest.data)!==pending.baseSignature||latest.data.startedAt);
    async function readUntil(accept){
     let latest={ok:false};
     for(let attempt=0;attempt<3;attempt++){
      if(!ctx.current())throw Error('stale-context');
      try{latest=await run(()=>ctx.read());}catch(e){if(e.message==='confirmation-timeout')throw e;latest={ok:false};}
      if(accept(latest)||competing(latest))return latest;
      if(attempt<2)await pause(attempt+1);
     }
     return latest;
    }
    let latest=await readUntil(value=>value?.ok===true);
    if(!ctx.current())return false;
    for(let attempt=0;!matches(latest,pending.snapshot);attempt++){
     if(!latest?.ok)throw Error('cloud-readback-unconfirmed');
     if(competing(latest)){
      ctx.apply(latest.data);pending=null;keep();
      throw Error('bracket-version-conflict');
     }
     if(signature(latest.data)!==pending.baseSignature||latest.data.startedAt)throw Error('bracket-version-conflict');
     // Both attempts use the persisted operation ID and identical pairing.
     // The transaction still rejects a concurrent draw/start or stale roster.
     let writeError=null,acknowledged=false;
     try{if(pending.adminOperationalOverride&&!ctx.authorizeOverride?.(pending.adminOperationalOverride))throw Error('admin-override-not-authorized');acknowledged=await run(()=>ctx.write(clone(pending.snapshot),{bracketCommit:{baseSignature:pending.baseSignature},...(pending.adminOperationalOverride?{adminOperationalOverride:pending.adminOperationalOverride}:{})}));}catch(e){writeError=e;}
     const failureCode=ctx.writeFailureCode?.()||writeError?.code||writeError?.message||'';
     keep();if(!ctx.current())return false;
     // Never flash failure while a committed private/public readback is settling.
     latest=await readUntil(value=>matches(value,pending.snapshot));
     if(matches(latest,pending.snapshot))break;
     if(competing(latest)){ctx.apply(latest.data);pending=null;keep();throw Error('bracket-version-conflict');}
     const canRebase=pending.adminOperationalOverride&&ctx.authorizeOverride?.(pending.adminOperationalOverride)&&
      ctx.rebaseOverride&&['registration-roster-stale','qr-checkin-state-stale','call-state-stale'].includes(failureCode)&&
      acknowledged===false&&!writeError&&latest?.ok&&signature(latest.data)===pending.baseSignature&&!latest.data.startedAt;
     if(canRebase){pending.snapshot=clone(ctx.rebaseOverride(latest.data,pending.snapshot,pending.adminOperationalOverride));keep();}
     const canRefreshNormal=!pending.adminOperationalOverride&&ctx.rebaseRosterFence&&
      ['registration-roster-stale','qr-checkin-state-stale'].includes(failureCode)&&
      acknowledged===false&&!writeError&&latest?.ok&&signature(latest.data)===pending.baseSignature&&!latest.data.startedAt;
     if(canRefreshNormal){
      const refreshed=ctx.rebaseRosterFence(latest.data,pending.snapshot);
      if(refreshed){pending.snapshot=clone(refreshed);keep();}
      else throw Error('bracket-roster-changed');
     }
     const permanent=!canRebase&&!canRefreshNormal&&/permission-denied|unauthenticated|stale|managed|bracket-version-conflict|bracket-started/.test(failureCode);
     // Only retry a rejected write after an authoritative unchanged-base read.
     // A timeout/unknown acknowledgement or a committed draw is read-only recovery.
     if(attempt>=(pending.adminOperationalOverride?2:1)||acknowledged!==false||writeError||permanent||!latest?.ok||
       signature(latest.data)!==pending.baseSignature||latest.data.startedAt)
      throw writeError||Error(failureCode||'cloud-readback-unconfirmed');
     await pause(1);
    }
    if(!ctx.current())return false;
    ctx.apply(latest.data);
   }else{
    if(await ctx.local(pending.snapshot)!==true)throw Error('local-save-unconfirmed');
    if(!ctx.current())return false;ctx.apply(pending.snapshot);
   }
   await feedback;if(!ctx.current())return false;
   pending=null;keep();result='success';ctx.success();return true;
  }catch(e){await feedback;error=e.message||'cloud-save-unconfirmed';result='failed';return false;}
  finally{busy=false;if(ctx.current())ctx.changed();}
 }
 async function begin(options={}){
  if(busy||pending||!ctx.current())return false;
  const override=options.adminOperationalOverride;
  if(override&&!ctx.authorizeOverride?.(override))return false;
  error='';result='';
  const base=ctx.state();if(base.startedAt||base.archiveStatus==='completed')return false;
  const snapshot=ctx.generate(options);if(!snapshot)return false;
  const id=ctx.operationId(),at=Date.now();
  snapshot.updatedAt=Math.max(at,Number(base.updatedAt||0)+1);
  snapshot.bracketDraw={id,revision:Number(base.bracketDraw?.revision||0)+1,at,actorUid:ctx.actorUid};
  snapshot.bracketDrawHistory=[...(base.bracketDrawHistory||[]),snapshot.bracketDraw].slice(-20);
  pending={baseSignature:signature(base),snapshot:clone(snapshot),...(override?{adminOperationalOverride:clone(override)}:{})};
  try{keep();}catch{error='pending-storage-unavailable';result='failed';ctx.changed();return false;}
  return retry();
 }
 async function discard(){
  if(busy||!pending||!ctx.current())return;
  busy=true;ctx.changed();
  try{
   if(ctx.cloud()){const latest=await deadline(ctx.read());if(!latest?.ok)throw Error('cloud-readback-unconfirmed');if(!ctx.current())return;ctx.apply(latest.data);}
   pending=null;keep();error='';result='';
  }catch(e){error=e.message;}
  finally{busy=false;if(ctx.current())ctx.changed();}
 }
 async function renewOverride(approval){
  const prior=pending?.adminOperationalOverride;
  if(busy||!prior||!ctx.current()||!ctx.authorizeOverride?.(approval)||approval.id!==prior.id||
   approval.operation!==prior.operation||JSON.stringify([...(approval.participantIds||[])].sort())!==JSON.stringify([...(prior.participantIds||[])].sort()))return false;
  pending.adminOperationalOverride=clone(approval);keep();return retry();
 }
 function selection(){
  const ids=[...new Set((pending?.snapshot.matches||[]).flatMap(m=>[m.a?.playerId,m.b?.playerId]).filter(Boolean).map(String))];
  return ids.map(id=>({id,name:(pending.snapshot.players||[]).find(p=>String(p.id)===id)?.name||id}));
 }
 async function forceSubmit(approval){
  if(busy||!pending||!ctx.current()||!ctx.authorizeOverride?.(approval)||approval.operation!=='draw-bracket')return false;
  const ids=selection().map(p=>p.id).sort(),approved=[...(approval.participantIds||[])].sort();
  if(JSON.stringify(ids)!==JSON.stringify(approved)||ids.length<2)return false;
  if(pending.adminOperationalOverride&&pending.adminOperationalOverride.id!==approval.id)return false;
  busy=true;error='';ctx.changed();let resume=false;
  try{
   // Read before promoting: a lost acknowledgement must not create a second draw.
   const latest=await deadline(ctx.read());
   if(!ctx.current())throw Error('stale-context');
   if(!ctx.authorizeOverride?.(approval))throw Error('admin-override-not-authorized');
   if(!latest?.ok)throw Error('cloud-readback-unconfirmed');
   if(latest.data.id!==pending.snapshot.id)throw Error('admin-override-room-changed');
   if(latest.data.startedAt||latest.data.archiveStatus==='completed')throw Error('bracket-started');
   if(matches(latest,pending.snapshot)){
    ctx.apply(latest.data);pending=null;keep();result='success';ctx.success();return true;
   }
   // A private commit awaiting its public mirror is read-only recovery.
   if(latest.data.bracketDraw?.id===pending.snapshot.bracketDraw.id)throw Error('cloud-readback-unconfirmed');
   if(signature(latest.data)!==pending.baseSignature)throw Error('bracket-version-conflict');
   if(latest.data.onsiteWaitlistServerOwned===true&&latest.data.onsiteWaitlistFinalized!==true)throw Error('onsite-waitlist-managed');
   const known=new Set((latest.data.players||[]).map(p=>String(p.id)));
   if(ids.some(id=>!known.has(id)))throw Error('admin-override-roster-changed');
   if(!ctx.rebaseOverride)throw Error('admin-override-rebase-unavailable');
   const rebased=clone(ctx.rebaseOverride(latest.data,clone(pending.snapshot),approval));
   if(signature(rebased)!==signature(pending.snapshot)||rebased.bracketDraw?.id!==pending.snapshot.bracketDraw.id||rebased.startedAt)
    throw Error('admin-override-pairing-changed');
   pending.snapshot=rebased;pending.adminOperationalOverride=clone(approval);keep();resume=true;
  }catch(e){error=e.code||e.message||'cloud-save-unconfirmed';result='failed';}
  finally{busy=false;if(ctx.current())ctx.changed();}
  return resume?retry():false;
 }
 return {begin,retry,discard,renewOverride,forceSubmit,selection,submit:()=>pending?retry():begin(),blocked:()=>busy||!!pending,busy:()=>busy,status:()=>({busy,pending:!!pending,error,result,override:pending?.adminOperationalOverride?clone(pending.adminOperationalOverride):null}),async verify(snapshot){
  if(busy||pending)return false;if(!ctx.cloud())return true;
  try{const latest=await deadline(ctx.read());return ctx.current()&&!busy&&!pending&&signature(ctx.state())===signature(snapshot)&&latest?.ok===true&&!latest.data.startedAt&&signature(latest.data)===signature(snapshot)&&signature(latest.publicData)===signature(snapshot);}catch{return false;}
 }};
}
const api={signature,assertWrite,create};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHBracketCommit=api;
})(typeof window==='object'?window:globalThis);


