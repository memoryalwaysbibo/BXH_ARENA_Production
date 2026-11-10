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
 let busy=false,pending=null,error='',result='',phase='',inFlightWrite=null;
 let phaseAt=0,timings=[],cancelRetry=null;
 function progress(next){
  const now=Date.now();if(phaseAt)timings.push({phase,elapsedMs:now-phaseAt});
  phase=next;phaseAt=now;
  try{ctx.trace?.({phase,timings:timings.slice()});}catch{}
  if(ctx.current())ctx.changed();
 }
 const key='bxh-bracket-pending-v1:'+ctx.key;
 try{const saved=JSON.parse(ctx.storage?.getItem(key)||'null');if(saved?.snapshot?.bracketDraw?.id&&saved.baseSignature){pending=saved;result='failed';error='pending-upload-unconfirmed';}}catch{}
 function keep(){if(pending){if(!ctx.storage)throw Error('pending-storage-unavailable');ctx.storage.setItem(key,JSON.stringify(pending));}else ctx.storage?.removeItem(key);}
 const deadline=(p,budget=Infinity)=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('confirmation-timeout')),Math.min(ctx.timeoutMs||20000,budget));p.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
 function matches(result,snapshot){return (!pending?.adminOperationalOverride||result?.data?.adminOperationOverrides?.some(r=>r.id===pending.adminOperationalOverride.id))&&result?.ok===true&&signature(result.data)===signature(snapshot)&&signature(result.publicData)===signature(snapshot)&&result.data.bracketDraw?.id===snapshot.bracketDraw?.id;}
 // A UI deadline cannot cancel a Firestore transaction. Reconcile its eventual
 // outcome read-only; never generate or submit another draw from this callback.
 async function reconcileLate(candidate){
  if(busy||pending!==candidate||!ctx.current())return;
  busy=true;progress('confirming');
  try{
   const latest=await deadline(ctx.read());
   if(!ctx.current()||pending!==candidate)return;
   if(!latest?.data?.startedAt&&latest?.data?.archiveStatus!=='completed'&&matches(latest,candidate.snapshot)){
    ctx.apply(latest.data);pending=null;keep();error='';result='success';progress('success');ctx.success();
   }
  }catch{}finally{busy=false;if(ctx.current())ctx.changed();}
 }
 async function retry(firstSubmission=false){
  if(busy||!pending||!ctx.current())return false;
  busy=true;error='';result='';phaseAt=0;timings=[];
  let lateWrite=null,cancelled=false,confirmedByTransaction=false;
  let stopWaiting;
  const stop=new Promise(resolve=>{stopWaiting=resolve;});
  cancelRetry=()=>{cancelled=true;stopWaiting();};
  const wait=promise=>Promise.race([promise,stop]).then(value=>{
   if(cancelled)throw Error('upload-cancelled');
   return value;
  });
  const feedbackUntil=Date.now()+(ctx.minimumFeedbackMs??(ctx.cloud()?2000:0));
  const waitForFeedback=()=>wait(new Promise(resolve=>setTimeout(resolve,Math.max(0,feedbackUntil-Date.now()))));
  ctx.changed();
  try{
   keep();
   if(ctx.cloud()){
    // Drain earlier state saves before starting the draw's network budget.
    // No draw write is enqueued if this independent queue wait expires.
    progress('waiting');
    try{if(ctx.waitForWrites)await wait(deadline(Promise.resolve(ctx.waitForWrites())));}
    catch(e){if(e.message==='confirmation-timeout')throw Error('queue-wait-timeout');throw e;}
    // Also serialize explicit retries with a transaction that outlived its UI.
    if(inFlightWrite){
     try{await wait(deadline(inFlightWrite));}catch(e){if(e.message==='confirmation-timeout')throw Error('queue-wait-timeout');}
    }
    if(cancelled||!ctx.current())return false;
    const expires=Date.now()+(ctx.totalTimeoutMs??25000);
    const run=fn=>{const remaining=expires-Date.now();if(remaining<=0)throw Error('confirmation-timeout');return wait(deadline(fn(),remaining));};
    const pause=async attempt=>{await wait(new Promise(resolve=>setTimeout(resolve,(ctx.confirmationDelayMs??500)*attempt)));if(!ctx.current())throw Error('stale-context');};
    const competing=latest=>latest?.ok===true&&!matches(latest,pending.snapshot)&&
     latest.data.bracketDraw?.id!==pending.snapshot.bracketDraw.id&&
     (signature(latest.data)!==pending.baseSignature||latest.data.startedAt);
    async function readUntil(accept){
     let latest={ok:false};
     for(let attempt=0;attempt<3;attempt++){
      if(!ctx.current())throw Error('stale-context');
      try{latest=await run(()=>ctx.read());}catch(e){if(cancelled||e.message==='confirmation-timeout')throw e;latest={ok:false};}
      if(accept(latest)||competing(latest))return latest;
      if(attempt<2)await pause(attempt+1);
     }
     return latest;
    }
    // A new draw has no earlier write to reconcile. The transaction checks
    // its base pairing, room state and roster against the server itself.
    let latest=null;
    if(!firstSubmission){
     progress('checking');
     latest=await readUntil(value=>value?.ok===true);
    }
    if(cancelled||!ctx.current())return false;
    for(let attempt=0;!matches(latest,pending.snapshot);attempt++){
     if(latest&&!latest.ok)throw Error('cloud-readback-unconfirmed');
     if(competing(latest)){
      ctx.apply(latest.data);pending=null;keep();
      throw Error('bracket-version-conflict');
     }
     if(latest&&(signature(latest.data)!==pending.baseSignature||latest.data.startedAt))throw Error('bracket-version-conflict');
     // Both attempts use the persisted operation ID and identical pairing.
     // The transaction still rejects a concurrent draw/start or stale roster.
     let writeError=null,acknowledged=false;
     try{
      if(pending.adminOperationalOverride&&!ctx.authorizeOverride?.(pending.adminOperationalOverride))throw Error('admin-override-not-authorized');
      progress('writing');
      acknowledged=await run(()=>{
       const promise=Promise.resolve(ctx.write(clone(pending.snapshot),{bracketCommit:{baseSignature:pending.baseSignature},...(pending.adminOperationalOverride?{adminOperationalOverride:pending.adminOperationalOverride}:{})}));
       inFlightWrite=promise;
       promise.finally(()=>{if(inFlightWrite===promise)inFlightWrite=null;}).catch(()=>{});
       lateWrite=promise;return promise;
      });
     }catch(e){writeError=e;}
     // A Firestore rejection is definitive for this transaction.
     if(['permission-denied','firestore/permission-denied'].includes(writeError?.code))throw Error('permission-denied');
     if(cancelled||!ctx.current())return false;
     if(acknowledged?.committed===true&&matches(acknowledged,pending.snapshot)){
      const local=ctx.state();
      const versionFields=['updatedAt','registrationRosterRevision','qrCheckinRevision','onsiteWaitlistRuntimeRevision','callRevision','entrySelectionRevision','teamResultRevision'];
      if(!local.startedAt&&local.archiveStatus!=='completed'&&
         versionFields.every(field=>Number(acknowledged.data[field]||0)>=Number(local[field]||0))){
       confirmedByTransaction=true;
       latest=acknowledged;
       break;
      }
     }
     const failureCode=ctx.writeFailureCode?.()||writeError?.code||writeError?.message||'';
     keep();if(cancelled||!ctx.current())return false;
     // Never flash failure while a committed private/public readback is settling.
     progress('confirming');latest=await readUntil(value=>matches(value,pending.snapshot));
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
    if(cancelled||!ctx.current())return false;
    ctx.apply(latest.data);
   }else{
    if(await ctx.local(pending.snapshot)!==true)throw Error('local-save-unconfirmed');
    if(cancelled||!ctx.current())return false;ctx.apply(pending.snapshot);
   }
   if(!confirmedByTransaction)await waitForFeedback();
   if(cancelled||!ctx.current())return false;
   pending=null;keep();result='success';progress('success');ctx.success();return true;
  }catch(e){
   if(cancelled)return false;
   try{if(e.message!=='permission-denied')await waitForFeedback();}catch{return false;}
   error=e.message||'cloud-save-unconfirmed';result='failed';
   try{ctx.trace?.({phase,error,elapsedMs:Date.now()-phaseAt,timings:timings.slice()});}catch{}
   return false;
  }
  finally{
   cancelRetry=null;
   busy=false;
   if(cancelled)await discard();
   if(pending&&error==='confirmation-timeout'&&lateWrite){
    const candidate=pending;
    lateWrite.then(()=>reconcileLate(candidate),()=>reconcileLate(candidate)).catch(()=>{});
   }
   if(ctx.current())ctx.changed();
  }
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
  return retry(!override);
 }
 async function discard(){
  if(!pending||!ctx.current())return;
  if(busy){cancelRetry?.();return;}
  busy=true;ctx.changed();
  try{
   if(ctx.cloud()){const latest=await deadline(ctx.read());if(!latest?.ok||!latest.publicData||signature(latest.data)!==signature(latest.publicData)||
    // The production public whitelist intentionally omits bracketDraw (it
    // contains the actor UID). Compare public pairing structure; only check
    // the operation ID when a projection explicitly includes it.
    (latest.publicData.bracketDraw?.id!=null&&latest.data.bracketDraw?.id!==latest.publicData.bracketDraw.id))throw Error('cloud-readback-unconfirmed');
    if(!ctx.current())return;ctx.apply(latest.data);}
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
 return {begin,retry,discard,renewOverride,forceSubmit,selection,submit:()=>pending?retry():begin(),blocked:()=>busy||!!pending,busy:()=>busy,status:()=>({busy,pending:!!pending,canDiscard:!!pending&&(!busy||!!cancelRetry),error,result,phase,timings:timings.slice(),override:pending?.adminOperationalOverride?clone(pending.adminOperationalOverride):null}),async verify(snapshot){
  if(busy||pending)return false;if(!ctx.cloud())return true;
  try{const latest=await deadline(ctx.read());return ctx.current()&&!busy&&!pending&&signature(ctx.state())===signature(snapshot)&&latest?.ok===true&&!latest.data.startedAt&&signature(latest.data)===signature(snapshot)&&signature(latest.publicData)===signature(snapshot);}catch{return false;}
 }};
}
function createServer(ctx){
 const key='bxh-v2-lifecycle:'+ctx.key;
 let pending=null,busy=false,error='',result='',phase='',action='draw';
 try{
  const saved=JSON.parse(ctx.storage?.getItem(key)||'null');
  if(['draw','start'].includes(saved?.action)&&saved.data?.operationId&&saved.data.code===ctx.code&&saved.data.roomId===ctx.roomId){
   pending=saved;action=saved.action;error='confirmation-timeout';
  }
 }catch{}
 function clear(){pending=null;try{ctx.storage?.removeItem(key);}catch{}}
 async function readPair(){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('confirmation-timeout')),ctx.readTimeoutMs??8000);});
  const latest=await Promise.race([Promise.resolve().then(ctx.read),timeout]).finally(()=>clearTimeout(timer));
  if(!ctx.current()||!latest?.ok||latest.data?.id!==ctx.roomId||!latest.publicData||
     signature(latest.data)!==signature(latest.publicData))throw Error('confirmation-timeout');
  return latest;
 }
 async function confirm(receipt,kind){
  // A server-only read can fail briefly even after the transaction has committed.
  // Keep the same operation pending and retry the read, never generating a new draw.
  const attempts=ctx.confirmationAttempts??3;
  for(let attempt=0;attempt<attempts;attempt++){
   try{
    const latest=await readPair();
    if(latest.data.bracketDraw?.id===receipt.drawId&&
       (kind!=='start'||latest.data.startedAt===receipt.startedAt&&latest.publicData.startedAt===receipt.startedAt)){
     return latest;
    }
    if(Number(latest.data.bracketDraw?.revision||0)>Number(receipt.revision||0)&&kind!=='start'){
     ctx.apply(latest.data);clear();throw Error('bracket-version-conflict');
    }
   }catch(e){
    if(e.message!=='confirmation-timeout')throw e;
   }
   if(!ctx.current())return null;
   if(attempt+1<attempts)await new Promise(resolve=>setTimeout(resolve,(ctx.confirmationDelayMs??500)*(attempt+1)));
  }
  throw Error('confirmation-timeout');
 }
 async function retry(){
  if(busy||!pending||!ctx.current())return false;
  const {action:kind,data}=pending;
  busy=true;error='';result='';phase='writing';ctx.changed();
  try{
   let receipt;
   for(let attempt=0;attempt<2;attempt++){
    try{receipt=await ctx.send(kind,data);break;}
    catch(e){
     if(!ctx.current())return false;
     if(attempt||!['functions/deadline-exceeded','functions/unavailable','functions/internal','functions/unknown'].includes(e.code))throw e;
     // The first call may have committed before its acknowledgement was lost.
     // Replaying the identical operation ID returns the original receipt.
    }
   }
   if(!ctx.current())return false;
   if(!receipt?.ok||!receipt.drawId||(kind==='start'&&!receipt.startedAt))throw Error('confirmation-timeout');
   phase='confirming';ctx.changed();
   const latest=await confirm(receipt,kind);
   if(!latest)return false;
   ctx.apply(latest.data);clear();result='success';ctx.success(kind);return true;
  }catch(e){
   if(!ctx.current())return false;
   if(['functions/failed-precondition','functions/invalid-argument','functions/not-found'].includes(e.code))clear();
   error=pending?'confirmation-timeout':e.message;result='failed';return false;
  }finally{busy=false;if(ctx.current())ctx.changed();}
 }
 async function submit(kind,options={}){
  if(busy||!ctx.current()||options.adminOperationalOverride)return false;
  if(pending)return pending.action===kind?retry():false;
  const snapshot=ctx.state();action=kind;
  const data={code:ctx.code,roomId:ctx.roomId,rosterRevision:options.rosterRevision??snapshot.registrationRosterRevision??0,
   operationId:ctx.operationId(),...(kind==='draw'?{baseDrawId:options.baseDrawId===undefined?(snapshot.bracketDraw?.id??null):options.baseDrawId}:
    {drawId:snapshot.bracketDraw?.id,confirmEarlyStart:options.confirmEarlyStart===true})};
  try{
   if(!ctx.storage)throw Error('pending-storage-unavailable');
   ctx.storage.setItem(key,JSON.stringify({action:kind,data}));pending={action:kind,data};
  }catch(e){error='pending-storage-unavailable';result='failed';ctx.changed();return false;}
  return retry();
 }
 return {server:true,begin:options=>submit('draw',options),start:confirmEarlyStart=>submit('start',{confirmEarlyStart}),
  retry,submit:()=>pending?retry():submit('draw'),blocked:()=>busy||!!pending,
  status:()=>({action,busy,pending:!!pending,error,result,phase}),async verify(snapshot){
   if(busy||pending)return false;
   try{const latest=await readPair();return !busy&&!pending&&!latest.data.startedAt&&latest.data.bracketDraw?.id===snapshot.bracketDraw?.id&&signature(ctx.state())===signature(snapshot)&&signature(latest.data)===signature(snapshot);}
   catch{return false;}
  }};
}
const api={signature,assertWrite,create,createServer};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHBracketCommit=api;
})(typeof window==='object'?window:globalThis);



