'use strict';
const {createHash}=require('node:crypto');
const PIN='822232b85bb737829852a4926682b96cd5cb7a7fe3105508681f9f1765648f79';
function patchAssembly(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==PIN)throw Error('assembly-source-drift');
 const before='const common={enabled:true,bridge,verifyAuth,documentId};';
 if(source.split(before).length!==2)throw Error('assembly-anchor-drift');
 return source.replace(before,"const resolveRoomLifecycle=require('./vendor/backend/bucket-lifecycle.cjs').readRoomLifecycle;\n  if(typeof resolveRoomLifecycle!=='function')throw Error('bucket-lifecycle-required');\n  const common={enabled:true,bridge,verifyAuth,documentId,resolveRoomLifecycle};");
}
module.exports={PIN,patchAssembly};
