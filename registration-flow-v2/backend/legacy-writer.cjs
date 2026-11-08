'use strict';

const roomCodePattern=/^BXH-[A-Z0-9]{4,16}$/;

function registrationQueueOwnsRoom(room){
 return room?.registrationQueueVersion===2;
}

// Install around legacy callable factories whose roster mutations use one
// transaction. Read the ownership flag in that transaction to fence cutover.
function createGuardedLegacyWriter({db,makeHandler,isMutation}){
 return async request=>{
  const code=String(request.data?.code||'').trim().toUpperCase();
  if(!roomCodePattern.test(code)||!isMutation(request.data?.action))return makeHandler(db)(request);
  const roomRef=db.doc('tournaments/'+code);
  const guarded=new Proxy(db,{get(target,key){
   if(key==='runTransaction')return (callback,options)=>target.runTransaction(async tx=>{
    const room=await tx.get(roomRef);
    if(registrationQueueOwnsRoom(room.data()))throw Error('registration-queue-required');
    return callback(tx);
   },options);
   const value=Reflect.get(target,key,target);
   return typeof value==='function'?value.bind(target):value;
  }});
  return makeHandler(guarded)(request);
 };
}

module.exports={registrationQueueOwnsRoom,createGuardedLegacyWriter};
