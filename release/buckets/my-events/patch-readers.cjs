'use strict';
const {createHash}=require('node:crypto');
const PIN={
 list:'647956d1477f3916981259a188928e962c2f04ab3779c383aa47205efecf7201',
 detail:'4a50f20ec750089f312fc4e7f7f453eb4654e7044f8f71ecfa1bd27d5107876c'
};
const sha=s=>createHash('sha256').update(s).digest('hex');
function once(source,before,after){
 if(source.split(before).length!==2)throw Error('reader-patch-anchor-drift');
 return source.replace(before,after);
}
function patchReader(kind,source){
 if(!Object.hasOwn(PIN,kind)||typeof source!=='string'||sha(source)!==PIN[kind])throw Error('reader-source-drift');
 const factory=kind==='list'?'createAuthenticatedReader':'createDetailReader';
 let out=once(source,
  `function ${factory}({enabled=false,bridge,verifyAuth,normalizeRoom=`,
  `function ${factory}({enabled=false,bridge,verifyAuth,resolveRoomLifecycle,normalizeRoom=`);
 out=once(out,
  "typeof normalizeRoom!=='function'||!bridge?.run",
  "typeof normalizeRoom!=='function'||typeof resolveRoomLifecycle!=='function'||!bridge?.run");
 out=once(out,
  'const life=normalizeRoom(room.data());',
  'const life=await resolveRoomLifecycle({db:bridge,tx,room,code,normalizeRoom});');
 if(out===source)throw Error('reader-patch-empty');
 return out;
}
module.exports={PIN,patchReader};
