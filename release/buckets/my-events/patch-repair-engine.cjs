'use strict';
const {createHash}=require('node:crypto');
const PIN='3b5f36dc1e0419284c9301a50f3f0eedba67c5f9d5b31921b473e306557afe86';
function once(source,before,after){
 if(source.split(before).length!==2)throw Error('repair-engine-anchor-drift');
 return source.replace(before,after);
}
function patchRepairEngine(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==PIN)throw Error('repair-engine-source-drift');
 let out=once(source,
  "function createEngine({bridge,enabled=false,clock=Date.now,documentId='__name__',hooks={}}={}){",
  "function createEngine({bridge,enabled=false,clock=Date.now,documentId='__name__',hooks={},resolveRoomLifecycle}={}){");
 out=once(out,
  "if(!bridge?.run||!bridge?.doc||!bridge?.collection)throw Error('bridge-required');",
  "if(!bridge?.run||!bridge?.doc||!bridge?.collection||typeof resolveRoomLifecycle!=='function')throw Error('bridge-or-lifecycle-required');");
 out=once(out,
  " const refPath=(code,id)=>PATHS.refs+'/'+code+'/registrations/'+id;",
  " async function verifiedTarget(tx,code,room){if(!room.exists)return 'missing';const life=await resolveRoomLifecycle({db:bridge,tx,room,code,normalizeRoom:normalizeLifecycle});return life.status==='supported'?(life.active?'active':'inactive'):life.status;}\n const refPath=(code,id)=>PATHS.refs+'/'+code+'/registrations/'+id;");
 out=once(out,
  'ct=stamp(row.createTime),ut=stamp(row.updateTime),t=target(room),at=now();',
  'ct=stamp(row.createTime),ut=stamp(row.updateTime),t=await verifiedTarget(tx,code,room),at=now();');
 out=once(out,
  'function makeJob(code,room,old,at){',
  'async function makeJob(tx,code,room,old,at){');
 out=once(out,
  'const t=target(room),inc=stamp(room.createTime);',
  'const t=await verifiedTarget(tx,code,room),inc=stamp(room.createTime);');
 out=once(out,
  'const next=makeJob(code,room,job.data(),now());',
  'const next=await makeJob(tx,code,room,job.data(),now());');
 out=once(out,
  'const replacement=makeJob(code,room,j,at);',
  'const replacement=await makeJob(tx,code,room,j,at);');
 return out;
}
module.exports={PIN,patchRepairEngine};
