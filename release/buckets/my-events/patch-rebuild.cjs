'use strict';
const {createHash}=require('node:crypto');
const PIN='abf972f4c72278b82823a750a09c18b41689ff8eb26127bce7d19992f57bb1ef';
function once(source,before,after){
 if(source.split(before).length!==2)throw Error('rebuild-anchor-drift');
 return source.replace(before,after);
}
function patchRebuild(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==PIN)throw Error('rebuild-source-drift');
 let out=once(source,
  "const {collectOwners}=require('./owners');",
  "const {collectOwners}=require('./owners');\nasync function verifiedTarget(resolveRoomLifecycle,b,tx,code,room){if(!room.exists)return 'missing';if(typeof resolveRoomLifecycle!=='function')throw Error('bucket-lifecycle-required');const life=await resolveRoomLifecycle({db:b,tx,room,code,normalizeRoom:require('./lifecycle.js').normalizeLifecycle});return life.status==='supported'?(life.active?'active':'inactive'):life.status;}");
 out=once(out,
  'expectedRebuildGeneration,rebuildLease}){',
  'expectedRebuildGeneration,rebuildLease,resolveRoomLifecycle}){');
 out=once(out,
  'ut=stamp(row.updateTime),t=target(room);',
  'ut=stamp(row.updateTime),t=await verifiedTarget(resolveRoomLifecycle,b,tx,code,room);');
 out=once(out,
  "function createRebuilder({bridge:b,engine,enabled=false,clock=Date.now,documentId='__name__',hooks={}}={}){",
  "function createRebuilder({bridge:b,engine,enabled=false,clock=Date.now,documentId='__name__',hooks={},resolveRoomLifecycle}={}){");
 out=once(out,
  "if(!b?.run||!b?.collectionGroup||!engine?.ingestRegistration)throw Error('rebuild-dependencies');",
  "if(!b?.run||!b?.collectionGroup||!engine?.ingestRegistration||typeof resolveRoomLifecycle!=='function')throw Error('rebuild-dependencies');");
 out=once(out,
  'async function beginRoom({code,runId=null}){',
  'async function beginRoom({code,runId=null,expectedSourceUpdateTime=null,expectedTarget=null}){');
 out=once(out,
  "if(runId&&(!r||r.state!=='running'||r.engineVersion!==ENGINE_VERSION))return {status:'invalid-run'};",
  "if(expectedSourceUpdateTime!==null&&!same(stamp(room.updateTime),expectedSourceUpdateTime))return {status:'stale-source'};if(expectedTarget!==null&&await verifiedTarget(resolveRoomLifecycle,b,tx,code,room)!==expectedTarget)return {status:'stale-source'};\n  if(runId&&(!r||r.state!=='running'||r.engineVersion!==ENGINE_VERSION))return {status:'invalid-run'};");
 out=once(out,
  'target:target(room),publishTarget:j.publishTarget',
  'target:await verifiedTarget(resolveRoomLifecycle,b,tx,code,room),publishTarget:j.publishTarget');
 out=once(out,
  'const exhausted=l.rows.length<PAGE;let phase=j.phase,',
  'const currentTarget=await verifiedTarget(resolveRoomLifecycle,b,tx,code,room);\n   const exhausted=l.rows.length<PAGE;let phase=j.phase,');
 out=once(out,
  "if(j.phase==='publish'&&target(room)!==l.target)",
  "if(j.phase==='publish'&&currentTarget!==l.target)");
 out=once(out,
  "publishTarget:phase==='publish'?target(room):j.publishTarget,restarts:j.restarts+(j.phase==='publish'&&target(room)!==l.target?1:0)",
  "publishTarget:phase==='publish'?currentTarget:j.publishTarget,restarts:j.restarts+(j.phase==='publish'&&currentTarget!==l.target?1:0)");
 out=once(out,
  "if(j.dualWrite)return {error:'active-cleanup'};tx.delete(entry.ref);return {status:'applied'};}\n  if(target(room)!==listedTarget)",
  "if(j.dualWrite)return {error:'active-cleanup'};tx.delete(entry.ref);return {status:'applied'};}\n  const currentTarget=await verifiedTarget(resolveRoomLifecycle,b,tx,c.code,room);\n  if(currentTarget!==listedTarget)");
 out=once(out,
  'return {restart:true,target:target(room)};',
  'return {restart:true,target:currentTarget};');
 out=once(out,
  's.counts,target(room),at,true)',
  's.counts,currentTarget,at,true)');
 out=once(out,
  "!['active','inactive','unsupported'].includes(target(room))",
  "!['active','inactive','unsupported'].includes(currentTarget)");
 out=once(out,
  's.counts,target(room),at));',
  's.counts,currentTarget,at));');
 if(out.includes('target(room)'))throw Error('rebuild-root-only-target-remains');
 return out;
}
module.exports={PIN,patchRebuild};
