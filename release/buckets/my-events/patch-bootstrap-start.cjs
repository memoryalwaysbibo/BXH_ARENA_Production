'use strict';
const {createHash}=require('node:crypto');
const PIN='6297f4f7bd41bc9ef0d324e6b69922915495dd4a7acbb4d4a613450d7b7be759';
function patchBootstrapStart(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==PIN)throw Error('bootstrap-start-source-drift');
 const before="  const engine=require('./vendor/backend/engine.cjs').createEngine({bridge,documentId,enabled:true});\n  const rebuilder=require('./vendor/backend/rebuild.cjs').createRebuilder({bridge,engine,documentId,enabled:true});\n  const bootstrap=require('./vendor/backend/bootstrap.cjs').createBootstrap({bridge,rebuilder,documentId,enabled:true});";
 if(source.split(before).length!==2)throw Error('bootstrap-start-anchor-drift');
 const after="  const resolveRoomLifecycle=require('./vendor/backend/bucket-lifecycle.cjs').readRoomLifecycle;\n  if(typeof resolveRoomLifecycle!=='function')throw Error('bucket-lifecycle-required');\n  const engine=require('./vendor/backend/engine.cjs').createEngine({bridge,documentId,enabled:true,resolveRoomLifecycle});\n  const rebuilder=require('./vendor/backend/rebuild.cjs').createRebuilder({bridge,engine,documentId,enabled:true,resolveRoomLifecycle});\n  const bootstrap=require('./vendor/backend/bootstrap.cjs').createBootstrap({bridge,rebuilder,documentId,enabled:true,resolveRoomLifecycle});";
 return source.replace(before,after);
}
module.exports={PIN,patchBootstrapStart};
