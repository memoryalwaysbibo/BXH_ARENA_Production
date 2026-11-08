'use strict';
const {createHash}=require('node:crypto');
const PIN='2588227c6dc3fa0fe8a80a0898eb7fdec6b2a52251d6c3ad139c8988cfb2dc89';
function once(source,before,after){
 if(source.split(before).length!==2)throw Error('service-anchor-drift');
 return source.replace(before,after);
}
function patchService(source){
 if(typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==PIN)throw Error('service-source-drift');
 let out=once(source,
  " const bridge=enabled===true?createAdminBridge(db):undefined;",
  " const bridge=enabled===true?createAdminBridge(db):undefined;\n const resolveRoomLifecycle=enabled===true?(factories.resolveRoomLifecycle||require('./bucket-lifecycle.cjs').readRoomLifecycle):undefined;");
 for(const call of ['createEngine({enabled,bridge,clock,documentId})','createRebuilder({enabled,bridge,engine,clock,documentId})','createBootstrap({enabled,bridge,rebuilder,clock,documentId})','createAuthenticatedReader({enabled,bridge,documentId,verifyAuth})']){
  out=once(out,call,call.replace('})',',resolveRoomLifecycle})'));
 }
 return out;
}
module.exports={PIN,patchService};
