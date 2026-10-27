(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
// Reserve 124 KiB below Firestore's 1 MiB document limit for root metadata.
// This payload budget is a guard, not a guarantee for arbitrary metadata or
// future score-log growth. Never truncate match data to make a write fit.
const MAX_PAYLOAD_BYTES=900*1024;
const CAPACITY_MESSAGE='賽事資料超過目前儲存容量，這次變更尚未送出。請保留現有資料並聯絡管理員。';
function assertCapacity(value){
 const text=typeof value==='string'?value:JSON.stringify(value);
 let bytes=0;
 for(const c of text){const point=c.codePointAt(0);bytes+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;}
 if(bytes>MAX_PAYLOAD_BYTES)throw Object.assign(new Error('tournament-payload-too-large'),{code:'tournament-payload-too-large',bytes,limit:MAX_PAYLOAD_BYTES});
 return {bytes,limit:MAX_PAYLOAD_BYTES};
}

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
 let busy=false,pending=null,error='';
 const key='bxh-bracket-pending-v1:'+ctx.key;
 try{const saved=JSON.parse(ctx.storage?.getItem(key)||'null');if(saved?.snapshot?.bracketDraw?.id&&saved.baseSignature)pending=saved;}catch{}
 function keep(){if(pending){if(!ctx.storage)throw Error('pending-storage-unavailable');ctx.storage.setItem(key,JSON.stringify(pending));}else ctx.storage?.removeItem(key);}
 const deadline=p=>Promise.race([p,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('confirmation-timeout')),ctx.timeoutMs||20000);p.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
 function matches(result,snapshot){return result?.ok===true&&signature(result.data)===signature(snapshot)&&signature(result.publicData)===signature(snapshot)&&result.data.bracketDraw?.id===snapshot.bracketDraw?.id;}
 async function retry(){
  if(busy||!pending||!ctx.current())return false;
  busy=true;error='';ctx.changed();
  try{
   assertCapacity(pending.snapshot);
   keep();
   if(ctx.cloud()){
    let latest=await deadline(ctx.read());
    if(!ctx.current())return false;
    if(!matches(latest,pending.snapshot)){
     if(!latest?.ok||signature(latest.data)!==pending.baseSignature||latest.data.startedAt)throw Error('bracket-version-conflict');
     // Never regenerate on retry. The transaction rejects concurrent draws/starts.
     const ok=await deadline(ctx.write(clone(pending.snapshot),{bracketCommit:{baseSignature:pending.baseSignature}}));
     keep();
     if(!ctx.current())return false;
     if(ok!==true)throw Error('cloud-save-unconfirmed');
     latest=await deadline(ctx.read());
     if(!matches(latest,pending.snapshot))throw Error('cloud-readback-unconfirmed');
    }
    if(!ctx.current())return false;
    ctx.apply(latest.data);
   }else{
    if(await ctx.local(pending.snapshot)!==true)throw Error('local-save-unconfirmed');
    if(!ctx.current())return false;ctx.apply(pending.snapshot);
   }
   pending=null;keep();ctx.success();return true;
  }catch(e){error=e.message||'cloud-save-unconfirmed';return false;}
  finally{busy=false;if(ctx.current())ctx.changed();}
 }
 async function begin(){
  if(busy||pending||!ctx.current())return false;
  const base=ctx.state();if(base.startedAt||base.archiveStatus==='completed')return false;
  const snapshot=ctx.generate();if(!snapshot)return false;
  const id=ctx.operationId(),at=Date.now();
  snapshot.updatedAt=Math.max(at,Number(base.updatedAt||0)+1);
  snapshot.bracketDraw={id,revision:Number(base.bracketDraw?.revision||0)+1,at,actorUid:ctx.actorUid};
  snapshot.bracketDrawHistory=[...(base.bracketDrawHistory||[]),snapshot.bracketDraw].slice(-20);
  try{assertCapacity(snapshot);}catch(e){error=e.code||e.message;ctx.changed();return false;}
  pending={baseSignature:signature(base),snapshot:clone(snapshot)};
  try{keep();}catch{error='pending-storage-unavailable';ctx.changed();return false;}
  return retry();
 }
 async function discard(){
  if(busy||!pending||!ctx.current())return;
  busy=true;ctx.changed();
  try{
   if(ctx.cloud()){const latest=await deadline(ctx.read());if(!latest?.ok)throw Error('cloud-readback-unconfirmed');if(!ctx.current())return;ctx.apply(latest.data);}
   pending=null;keep();error='';
  }catch(e){error=e.message;}
  finally{busy=false;if(ctx.current())ctx.changed();}
 }
 return {begin,retry,discard,blocked:()=>busy||!!pending,busy:()=>busy,status:()=>({busy,pending:!!pending,error}),async verify(snapshot){
  if(busy||pending)return false;if(!ctx.cloud())return true;
  try{const latest=await deadline(ctx.read());return ctx.current()&&!busy&&!pending&&signature(ctx.state())===signature(snapshot)&&latest?.ok===true&&!latest.data.startedAt&&signature(latest.data)===signature(snapshot)&&signature(latest.publicData)===signature(snapshot);}catch{return false;}
 }};
}
const api={signature,assertWrite,create,assertCapacity,MAX_PAYLOAD_BYTES,CAPACITY_MESSAGE};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHBracketCommit=api;
})(typeof window==='object'?window:globalThis);
