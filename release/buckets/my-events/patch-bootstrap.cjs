'use strict';
const {createHash}=require('node:crypto');
const PIN='8ff7a99e0b571aa56052f1774029c693c0001622115b674f8bc5fc6daf8b71d2';
function once(source,before,after){
 if(source.split(before).length!==2)throw Error('bootstrap-anchor-drift');
 return source.replace(before,after);
}
function patchBootstrap(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==PIN)throw Error('bootstrap-source-drift');
 let out=once(source,
  "const {SCHEMA,RELEASE}=require('./engine.cjs');",
  "const {SCHEMA,RELEASE,stamp,same}=require('./engine.cjs');");
 out=once(out,
  "const BOOTSTRAP_SCHEMA=26,SCOPE='individual-family',PAGE=32,LEASE_MS=15000;",
  "const BOOTSTRAP_SCHEMA=26,SCOPE='individual-family',PAGE=1,LEASE_MS=60000;");
 out=once(out,
  'function discoveryScope(raw){const life=normalizeLifecycle(raw);',
  'function discoveryScope(raw,life=normalizeLifecycle(raw)){');
 out=once(out,
  "function createBootstrap({bridge,rebuilder,enabled=false,clock=Date.now,documentId='__name__',hooks={}}={}){",
  "function createBootstrap({bridge,rebuilder,enabled=false,clock=Date.now,documentId='__name__',hooks={},resolveRoomLifecycle}={}){");
 out=once(out,
  "typeof rebuilder?.beginRoom!=='function')throw Error('bootstrap-dependencies-required');",
  "typeof rebuilder?.beginRoom!=='function'||typeof resolveRoomLifecycle!=='function')throw Error('bootstrap-dependencies-required');");
 out=once(out,
  " const now=()=>{const n=clock();if(!natural(n))throw Error('invalid-clock');return n;};",
  " const now=()=>{const n=clock();if(!natural(n))throw Error('invalid-clock');return n;};\n async function verifiedScope(tx,code,room){if(!room.exists)return 'missing';if(!stamp(room.createTime)||!stamp(room.updateTime))return 'unresolved';const life=await resolveRoomLifecycle({db:bridge,tx,room,code,normalizeRoom:normalizeLifecycle});return discoveryScope(room.data(),life);}\n const sameSource=(a,b)=>a.exists===true&&b.exists===true&&!!stamp(a.createTime)&&!!stamp(a.updateTime)&&same(stamp(a.createTime),stamp(b.createTime))&&same(stamp(a.updateTime),stamp(b.updateTime));");
 out=once(out,
  ' async function finalizeRun(runId){',
  " async function retrySource(c){return (await bridge.run('v26-bootstrap-source-changed',async tx=>{const d=await tx.get(runRef(c.runId)),r=d.data(),at=now();if(!owns(r,c,at))return {status:'stale'};tx.set(d.ref,{...r,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at});return {status:'stale-source'};})).value;}\n async function finalizeRun(runId){");
 out=once(out,
  'const codes=[];let skippedInactive=0,excluded=0;for(const d of rows.docs){',
  'const codes=[],scopes=new Map();let skippedInactive=0,excluded=0;for(const d of rows.docs){');
 out=once(out,
  "const scope=discoveryScope(d.data());if(scope==='unresolved')",
  "const proof=(await bridge.run('v26-bootstrap-verify-scope',async tx=>{const current=await tx.get(bridge.doc('tournaments/'+d.id));if(!sameSource(d,current))return {same:false};return {same:true,scope:await verifiedScope(tx,d.id,current)};},{readOnly:true})).value;if(!proof.same)return retrySource(c);const scope=proof.scope;scopes.set(d.id,{scope,updateTime:stamp(d.updateTime)});if(scope==='unresolved')");
 out=once(out,
  'rebuilder.beginRoom({code,runId});',
  "rebuilder.beginRoom({code,runId,...(c.phase==='rooms'?{expectedSourceUpdateTime:scopes.get(code)?.updateTime,expectedTarget:'active'}:{})});");
 out=once(out,
  "if(out?.status==='busy'){await bridge.run('v26-bootstrap-enqueue-wait'",
  "if(out?.status==='stale-source')return retrySource(c);if(out?.status==='busy'){await bridge.run('v26-bootstrap-enqueue-wait'");
 out=once(out,
  'valid(r,runId);const done=rows.size<PAGE,',
  "valid(r,runId);if(c.phase==='rooms'){for(const row of rows.docs){const current=await tx.get(bridge.doc('tournaments/'+row.id));if(!sameSource(row,current)||await verifiedScope(tx,row.id,current)!==scopes.get(row.id)?.scope){tx.set(d.ref,{...r,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at});return {status:'stale-source'};}}}const done=rows.size<PAGE,");
 out=once(out,
  "return {exists:room.exists,scope:room.exists?discoveryScope(room.data()):'missing',alreadyQueued:job.data()?.runId===p.runId};",
  "return {exists:room.exists,scope:await verifiedScope(tx,code,room),sourceUpdateTime:stamp(room.updateTime),alreadyQueued:job.data()?.runId===p.runId};");
 out=once(out,
  "if(current.alreadyQueued||!current.exists||current.scope==='active')return rebuilder.beginRoom({code,runId:p.runId});",
  "if(current.alreadyQueued||!current.exists)return rebuilder.beginRoom({code,runId:p.runId});if(current.scope==='active')return rebuilder.beginRoom({code,runId:p.runId,expectedSourceUpdateTime:current.sourceUpdateTime,expectedTarget:'active'});");
 return out;
}
module.exports={PIN,patchBootstrap};
